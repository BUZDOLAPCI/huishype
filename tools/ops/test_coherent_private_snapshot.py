"""Focused ACK race reproduction in a disposable local PostgreSQL container."""
import json
import subprocess
import time
import unittest
import uuid

from coherent_private_snapshot import adapt_remote, snapshot_sql


class PrivateSnapshotTest(unittest.TestCase):
    def test_ack_race_and_single_statement_snapshot(self):
        name = 'hh-snapshot-test-' + uuid.uuid4().hex[:12]
        def command(sql):
            return ['docker', 'exec', name, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-c', sql]
        def sql(query):
            return subprocess.check_output(command(query), text=True, timeout=10).strip()
        subprocess.run(['docker', 'run', '-d', '--rm', '--name', name,
                        '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                        'postgres:16-alpine'], check=True, capture_output=True, timeout=30)
        locker = reader = None
        try:
            deadline = time.monotonic() + 20
            while subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                                 capture_output=True).returncode:
                if time.monotonic() > deadline:
                    self.fail('isolated postgres startup timeout')
                time.sleep(.1)
            sql('CREATE TABLE cache(bytes int); INSERT INTO cache VALUES(893)')
            queries = {
                'sizing_ledger': "SELECT json_build_object('attempt_count',208)",
                'paused_cache_hold': "SELECT json_build_object('cache_entries',count(*),'cache_bytes',coalesce(sum(bytes),0)) FROM cache",
                'one_step_private': "SELECT json_build_object('original35',json_build_object('count',171),'cache',coalesce(json_agg(cache),'[]'::json)) FROM cache",
            }
            # Prior producer: ACK committed between its independent SELECTs.
            old_hold = json.loads(sql(queries['paused_cache_hold']))
            sql('DELETE FROM cache')
            old_inventory = json.loads(sql(queries['one_step_private']))['cache']
            self.assertEqual((old_hold['cache_entries'], old_hold['cache_bytes'], old_inventory), (1, 893, []))
            sql('INSERT INTO cache VALUES(893)')
            # Pause the combined SELECT after snapshot acquisition, then ACK.
            locker = subprocess.Popen(['docker', 'exec', '-i', name, 'psql', '-XAt', '-v',
                                       'ON_ERROR_STOP=1', '-U', 'postgres'], stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            locker.stdin.write("SELECT pg_advisory_lock(88199); SELECT 'locked';\n")
            locker.stdin.flush()
            while locker.stdout.readline().strip() != 'locked':
                if locker.poll() is not None:
                    self.fail('lock session exited')
            blocked = dict(queries)
            blocked['sizing_ledger'] = "SELECT json_build_object('attempt_count',208) FROM pg_advisory_xact_lock(88199)"
            reader = subprocess.Popen(command(snapshot_sql(blocked)), stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 10
            while sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='advisory'") != '1':
                if time.monotonic() > deadline:
                    self.fail('snapshot lock barrier timeout')
                time.sleep(.05)
            sql('DELETE FROM cache')
            locker.stdin.write('SELECT pg_advisory_unlock(88199);\n')
            locker.stdin.flush()
            output, error = reader.communicate(timeout=10)
            self.assertEqual(reader.returncode, 0, error)
            captured = json.loads(output)
            self.assertEqual(captured['paused_cache_hold'], {'cache_entries': 1, 'cache_bytes': 893})
            self.assertEqual(captured['one_step_private']['cache'], [{'bytes': 893}])
            after = json.loads(sql(snapshot_sql(queries)))
            self.assertEqual(after['paused_cache_hold'], {'cache_entries': 0, 'cache_bytes': 0})
            self.assertEqual(after['one_step_private']['cache'], [])
            # Adapter preserves original scalar queries and makes exactly one call.
            source = "if role=='scraper':\n" + ''.join(
                '    result[' + repr(key) + ']=phase_sql(\'huishype-funda-scraper-ledger-postgres-1\',' + repr(query) + ')\n'
                for key, query in queries.items())
            source += "    result['new_diagnostic_cache']=result['one_step_private']['cache']\n"
            source += "    result['one_step_private']=result['one_step_private']['original35']\n"
            calls = []
            def phase_sql(container, query):
                calls.append((container, query))
                return json.loads(sql(query))
            result = {}
            exec(adapt_remote(source), {'role': 'scraper', 'result': result, 'phase_sql': phase_sql})
            self.assertEqual(len(calls), 1)
            self.assertEqual(result['new_diagnostic_cache'], after['one_step_private']['cache'])
            self.assertEqual(result['one_step_private'], after['one_step_private']['original35'])
            self.assertEqual(result['paused_cache_hold'], after['paused_cache_hold'])
            self.assertEqual(result['sizing_ledger'], after['sizing_ledger'])
        finally:
            for process in (reader, locker):
                if process is not None and process.poll() is None:
                    process.kill()
                    process.communicate(timeout=5)
            subprocess.run(['docker', 'rm', '-f', name], check=True, capture_output=True, timeout=15)


if __name__ == '__main__':
    unittest.main()
