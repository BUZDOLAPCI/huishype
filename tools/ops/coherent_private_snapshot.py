"""Group coupled private-ledger observations in one PostgreSQL MVCC statement.

This offline adapter preserves reviewed SQL and watch validators verbatim. It
never connects to a database or starts a controller. Adapted watches keep the
existing read-only PGOPTIONS, timeout, transport and output budgets.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

FIELDS = ('sizing_ledger', 'paused_cache_hold', 'one_step_private')
CONTAINER = 'huishype-funda-scraper-ledger-postgres-1'


def snapshot_sql(queries):
    """Trusted scalar SELECTs, sharing one statement snapshot (READ COMMITTED).

    Counts remain independent aggregate queries: no truncation or deriving a
    count from the returned inventory, so incomplete inventories still fail.
    """
    if tuple(queries) != FIELDS:
        raise ValueError('private_snapshot_fields_changed')
    parts = []
    for key, query in queries.items():
        if not query.startswith('SELECT ') or ';' in query:
            raise ValueError('single_scalar_select_required')
        parts.extend((repr(key), '(' + query + ')'))
    return 'SELECT json_build_object(' + ','.join(parts) + ')'


def adapt_remote(source):
    assignments = {}
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not (isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name)
                and target.value.id == 'result' and isinstance(target.slice, ast.Constant)
                and target.slice.value in FIELDS):
            continue
        key = target.slice.value
        call = node.value
        if (key == 'one_step_private' and key in assignments
                and ast.unparse(call) == "result['one_step_private']['original35']"):
            continue  # Existing post-capture projection; preserve it verbatim.
        if (key in assignments or not isinstance(call, ast.Call)
                or not isinstance(call.func, ast.Name) or call.func.id != 'phase_sql'
                or len(call.args) != 2 or call.keywords
                or ast.literal_eval(call.args[0]) != CONTAINER):
            raise ValueError('private_capture_shape_changed')
        assignments[key] = (node, ast.literal_eval(call.args[1]))
    if set(assignments) != set(FIELDS):
        raise ValueError('private_capture_fields_missing')
    nodes = [assignments[key][0] for key in FIELDS]
    if [n.lineno for n in nodes] != sorted(n.lineno for n in nodes):
        raise ValueError('private_capture_order_changed')
    query = snapshot_sql({key: assignments[key][1] for key in FIELDS})
    lines = source.splitlines(keepends=True)
    for key in reversed(FIELDS):
        node = assignments[key][0]
        indent = ' ' * node.col_offset
        replacement = ('result.update(phase_sql(' + repr(CONTAINER) + ',' + repr(query) + '))'
                       if key == FIELDS[0] else 'pass  # Captured in the shared private-ledger statement above.')
        lines[node.lineno - 1:node.end_lineno] = [indent + replacement + '\n']
    result = ''.join(lines)
    ast.parse(result)
    return result


def adapt_watcher(source):
    """Replace only the embedded remote producer literal; fail on shape drift."""
    candidates = [n for n in ast.walk(ast.parse(source))
                  if isinstance(n, ast.Constant) and isinstance(n.value, str)
                  and "result['sizing_ledger']=phase_sql(" in n.value
                  and "result['one_step_private']=phase_sql(" in n.value]
    if len(candidates) != 1:
        raise ValueError('embedded_private_producer_ambiguous')
    node = candidates[0]
    lines = source.splitlines(keepends=True)
    start = sum(len(line) for line in lines[:node.lineno - 1]) + node.col_offset
    end = sum(len(line) for line in lines[:node.end_lineno - 1]) + node.end_col_offset
    remote = adapt_remote(node.value)
    if '"""' in remote:
        raise ValueError('embedded_producer_delimiter_changed')
    adapted = source[:start] + 'r"""' + remote + '"""' + source[end:]
    ast.parse(adapted)
    return adapted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    original = args.input.read_bytes()
    if hashlib.sha256(original).hexdigest() != args.expected_sha256:
        raise ValueError('watcher_provenance_changed')
    output = adapt_watcher(original.decode()).encode()
    with args.output.open('xb') as handle:
        handle.write(output)
    print(json.dumps({'input_sha256': args.expected_sha256,
                      'output_sha256': hashlib.sha256(output).hexdigest(),
                      'adapter_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                      'fields': FIELDS}))


if __name__ == '__main__':
    main()
