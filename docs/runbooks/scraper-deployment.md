# Scraper Deployment Runbook

This runbook is the source of truth for operating the production Funda and
Pararius scraper/source-service stacks. The scrapers run on a separate Hetzner
CX23 VM so scraper traffic and upstream rate behavior do not share the public
IP of the HuisHype app/prod VM.

## Secrets

Operator secrets are recorded in the gitignored root file:

```bash
/home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
```

That file mirrors the deployment/API keys needed to operate the scraper VM and
records where the live runtime env files live on the VM. Do not commit it and do
not copy its values into tracked docs. The live stack secrets remain on the VM:

- Funda: `/opt/huishype-scrapers/huishype-funda-scraper/.env.production`
- Pararius: `/opt/huishype-scrapers/huishype-pararius-scraper/.env`

The app/prod Coolify env must use the scraper API keys from
`.env.scraper-deploy` as `FUNDA_SOURCE_SERVICE_API_KEY` and
`PARARIUS_SOURCE_SERVICE_API_KEY`, and must use the shared
`HUISHYPE_INGEST_API_KEY` value as `INGEST_API_KEY`.

## Current Infrastructure

| Item                  | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Scraper VM            | `huishype-scrapers-cx23-nbg1`                             |
| Hetzner server ID     | `127989278`                                               |
| Plan                  | `CX23`                                                    |
| Datacenter            | `nbg1-dc3`                                                |
| Public IPv4           | `46.225.56.31`                                           |
| Primary IPv4 ID       | `148932647`                                              |
| Private IPv4          | `10.42.0.2`                                               |
| SSH user              | `root`                                                    |
| Runtime root          | `/opt/huishype-scrapers`                                  |
| App/prod VM           | `huishype-coolify-ubuntu-8gb-nbg1`, server ID `124870912` |
| App/prod private IPv4 | `10.42.0.10`                                              |
| App/prod public IPv4  | `94.130.105.129`                                          |
| Private network       | `huishype-private`, ID `12161934`, range `10.42.0.0/16`   |
| Scraper firewall      | `huishype-scraper-vm`, ID `10889637`                      |

The scraper firewall allows:

- TCP `22` from the operator workstation and app/prod public IP.
- TCP `8100-8101` only from `10.42.0.10/32`.
- ICMP from the operator workstation, app/prod public IP, and `10.42.0.0/16`.

The scraper VM also runs UFW with matching inbound restrictions for SSH and
source-service ports. When operator SSH access changes, keep the Hetzner
firewall and the VM-local UFW `22/tcp` allow list in sync.

No third-party outbound proxy is configured in the checked env files. Scraper
upstream egress currently leaves through `46.225.56.31`, not through the
HuisHype app/prod public IP.

### 2026-09-10 Initial Upstream Sync And IPv4 Refresh

Funda revision `40aa1d3` includes pyfunda revision `09f3286`, merging upstream
`8c7cfce`: release `v3.1.5` (tag commit `58bd8f6`) plus a README update. Both
fork revisions were pushed, and both scraper forks were clean and synchronized
with their origins. Initial validation passed: 525 Funda tests, 183 Pararius tests,
46 pyfunda tests with 9 subtests, and offline HTTP 401/403 and Nuxt parsing
smoke checks. Both deployed runtime directories checksum-matched tracked local
source. All 16 containers were healthy; all six Funda application roles used the
same image (`sha256:45b84bf14e7a53dce925cbda192e3c9a839097c4b9cb1016db648887f4cd613d`)
with pyfunda `3.1.5`.

Primary IPv4 `148932647` (`46.225.56.31`) is assigned to the existing scraper
VM. Its server ID and private IPv4 are unchanged, so app source-service URLs
remain unchanged. The host IPv6 allocation `2a01:4f8:c0c:55a7::/64` (primary IP
ID `128143021`) is unchanged; both scraper Docker networks have IPv6 disabled.
The previous IPv4 `178.104.119.167` (primary IP ID `128143020`) remains reserved
and unassigned for rollback. The SSH host key was verified unchanged; the host
route and an egress check inside the Funda API container confirm `46.225.56.31`.
Both databases accept connections, and both private health endpoints return
HTTP 200 from the app VM.

Pre-change backups are stored on the VM at
`/opt/huishype-scrapers/pre-sync-20260910-2EeGV0` and locally at
`/home/caslan/dev/backups/huishype/scraper-sync-20260910-lhOWU9/`. The local copy
contains both mirror database dumps, Redis snapshots, and a source/env archive;
all checksums were verified, including matching remote/local Redis snapshot
hashes. Treat these backups as sensitive because they include runtime
credentials and listing data.

The old Funda image digests were unavailable in Docker's image store. Rollback
images were recovered through container filesystem export/import under
`pre-sync-20260910-<role>` tags and smoke tested. These imported snapshots rely
on Compose to reapply runtime settings.

Post-rotation controlled probes on 2026-09-10 found:

- Funda detail first succeeded at `06:25:11 UTC` and reached ten consecutive
  recovery successes at `06:30:10 UTC`, becoming healthy. Normal detail jobs
  then completed approximately every five seconds, including status changes
  and withdrawals. The first 25 deferred detail jobs were released; before
  the drain, 800 search jobs and 13,138 detail jobs were deferred.
- Funda search received HTTP 401 from the mobile API and activated the new
  `3.1.5` web fallback. That fallback failed with curl error 92
  (`HTTP/2 INTERNAL_ERROR`). One leased HTTP/1.1 diagnostic timed out after
  30 seconds (curl error 28); its process-only patch was not retained. Search
  was guarded for 86,400 seconds with reason
  `web_search_transport_error_curl92` while detail processing resumed.
- Pararius still returned HTTP 403 at `06:25:15 UTC`, reaching 20 consecutive
  blocks. Its next circuit probe is due on 2026-09-11 at `06:25:15 UTC`.

All services resumed under these persistent circuit guards. Restarting Funda
sync triggered its normal 300-second sync cycle at `06:31:14 UTC`: 12 listings
were accepted in batch `276208d8-7a9e-4906-9f47-26e5194ce9f0`. Production app
Postgres confirmed 11 fresh Funda observations (latest source observation
`06:31:03.677 UTC`) and canonical updates after `06:31:14 UTC`. No fresh
Pararius observations were found. No queues were cleared.

At `06:32:30 UTC`, Funda status still reported detail healthy with HTTP 200,
`latestSuccessfulIngest=2026-09-10T06:31:14.056619+00:00`, and a newest available
observation at `06:32:30 UTC`. Stale available observations decreased from
74,144 to 74,120. Scheduling had resumed too: 6,299 normal detail jobs were
pending alongside 13,863 deferred jobs. This confirms processing and bounded
deferred release resumed, not that the total queue is shrinking.

At the initial `06:32:30 UTC` check, recovery was partial: Funda detail updates
and ingest were working while Funda search and Pararius remained in cooldown.
The Funda search follow-up below supersedes that initial search outcome.

### 2026-09-10 Funda Web-Search Fingerprint Follow-Up

[Upstream pyfunda PR #16](https://github.com/0xMH/pyfunda/pull/16) changes the
web-search browser fingerprint from fixed `chrome124` to a configurable
`chrome` alias. Its commit `52d9e4657216760ad3b1b5fa3d8429b60198802f` was
cherry-picked with provenance into the pyfunda fork as `38a117c`, consumed by
Funda scraper revision `a16cfba`; both fork revisions were pushed. This applies
the unmerged upstream change rather than waiting for another pyfunda release.
The production `curl_cffi 0.15.0` resolves `chrome` to `chrome146`.

Validation passed: 50 pyfunda tests with 9 subtests, 525 scraper tests, mocked
session constructor/cache/cleanup smoke checks, and Compose configuration
validation. All Funda application roles were deployed with image
`sha256:c6c4643109f58d33690aa3aa7bfecdb50b2e5a88a68783ad45ae695b350a1824`.

Verified pre-change backups are stored on the VM at
`/opt/huishype-scrapers/pre-pr16-20260910-himwrn` and locally at
`/home/caslan/dev/backups/huishype/funda-pr16-20260910-RcyCtc/`. They include
both mirror database dumps, the Funda Redis snapshot, and a source/env archive.
Rollback tag `huishype/funda-scraper:pre-pr16-20260910` points to the prior
`45b84bf14e7a53dce925cbda192e3c9a839097c4b9cb1016db648887f4cd613d` image.

From the unchanged Hetzner egress `46.225.56.31`, a leased search probe at
`06:44:11 UTC` succeeded with 15 parsed Eindhoven buy listings using the new
fingerprint. Sample IDs `44598239`, `44598890`, and `44597361` were absent from
the mirror before the pipeline check. A detail probe also succeeded at
`06:44:26 UTC`. Continuous probes subsequently recorded all ten required
recovery successes: search became healthy at `06:49:11 UTC`, and detail at
`06:49:16 UTC`. Both consecutive block counts reset to zero. Released discovery
jobs successfully stored new listings. All six Funda application roles were
verified healthy on the new image, and all 16 scraper containers were healthy.

Sync batch `2e24fcb0-a879-487b-991d-03a60d354693` accepted 123 records at
`06:50:46.771 UTC`. Main app Postgres confirmed 119 Funda observations since
`06:44 UTC`, with a latest observation at `06:50:33.669 UTC`; source IDs
`44580964`, `80914409`, and `44589912` had active canonical listings updated
at `06:50:46.849883 UTC`.

One bounded high-priority Eindhoven buy page 0 verification job
(`a77ade0d-3673-4faf-ad88-842a0140efaa`) completed on its first attempt without
error at `06:51:44.168 UTC`. The three sample IDs above became newly available
in the mirror at `06:51:41 UTC`. Only this verification job was atomically
promoted within the high-priority queue; other jobs retained their relative
order, and no queues were cleared.

Follow-up sync batch `6d0a4048-eb01-44b2-8ad4-2d62daebf2b1` accepted 107
records at `06:52:21.806 UTC`. Production canonical listings for all three
sample source IDs (`44597361`, `44598239`, and `44598890`) were active, updated
at `06:52:21.858019 UTC`, with `last_mirror_seen_at=06:52:01.493 UTC`.
Production had 224 fresh Funda observations since `06:44 UTC`, with a latest
observation at `06:52:01.493 UTC`. This verifies the targeted worker search,
mirror write, sync delivery, and app canonical update end to end.

At `06:51:54 UTC`, both Funda capabilities remained healthy with HTTP 200.
Overall Funda status remained degraded/stale because the backlog persisted:
73,974 stale listings, 430 pending jobs, 19,924 deferred jobs, and zero failed
jobs. Both private health endpoints returned HTTP 200 from the app VM. Working
source access and ingest do not mean the historical backlog has caught up.

The earlier curl error 92 described the pre-PR #16 deployment. The successful
search probes and discovery jobs on the same IP after the fingerprint change
supersede that initial search result. Pararius was unchanged and remained in
its HTTP 403 cooldown, with its next probe due on 2026-09-11 at
`06:25:15.990 UTC`.

### 2026-09-10 Funda Freshness And Scheduling Follow-Up

Funda scraper revision `daf9be2` was committed and pushed to `main`. Validation
passed: 548 tests, Ruff checks for the new modules, and Compose API/scheduler
configuration parity with non-default overrides. A separate PostgreSQL 16
check migrated from the old head to the new head, downgraded, and upgraded
again; a populated fixed-cohort check reported two members, one checked, and
50% progress, including a withdrawn listing. Its temporary database/container
was removed afterward.

Before this change, the live scheduler used `UPDATE_INTERVAL_HOURS=8`, while
the API's stale count used its default four-hour window. That mismatch meant
the reported stale count did not use the scheduler's actual refresh deadline.
The implementation now shares the tiered policy described below between API
status and scheduling. Earlier stale-count snapshots in this runbook use the
old definition and should not be compared directly with the new policy.

The deployed image is
`sha256:fb41c5204529adb46624624528323edc7ba618beb40ac40e0a4835e3c6f1d012`.
Rollback tag `huishype/funda-scraper:pre-freshness-20260910` retains the preceding
`c6c4643109f58d33690aa3aa7bfecdb50b2e5a88a68783ad45ae695b350a1824` image.
Verified backups are stored remotely at
`/opt/huishype-scrapers/pre-freshness-20260910-0dBSju` and locally at
`/home/caslan/dev/backups/huishype/funda-freshness-20260910-h1AbTv/`. They contain
the Funda PostgreSQL dump, Redis RDB, and source/env archive. All remote/local
SHA-256 checks passed, and the PostgreSQL archive listing was validated.

Production migrated to additive revision `e8c2a1f6b930`, creating
`refresh_recovery_runs` and `refresh_recovery_items`. The explicitly initialized
cohort `freshness-recovery-20260910` started at
`2026-09-10T16:37:08.106792Z` with 74,058 available listings and zero initially
checked. This is a new baseline; it does not reconstruct membership or progress
at the beginning of the original outage.

All six Funda application roles restarted, and both source circuits remained
healthy. API and scheduler runtime settings matched: 24-hour recent refresh,
168-hour stable refresh, seven-day recent window, 15-minute top-up interval,
100-job batch, and 1,000-job outstanding threshold. Production env settings
were explicit, and obsolete `UPDATE_INTERVAL_HOURS=8` was removed. Discovery
remained every three hours and polling every 15 minutes.

At `16:37:14 UTC`, the scheduler correctly paused top-ups with 18,285
outstanding jobs against the 1,000-job threshold while existing work continued.
At `16:37:38 UTC`, status reported one cohort member checked and 69,940 stale
listings under the new tiered criteria. Recovery subsequently advanced through
five to ten checked members. At `16:40 UTC`, the fixed total remained 74,058,
with ten checked, 74,048 remaining, and 0.01% progress. There were zero daily
listings due and 69,940 weekly listings due. Normal detail jobs continued
completing, and both source circuits remained healthy. The 110 pre-existing
location-name failures were unchanged.

All six Funda application roles were verified healthy on the new image; all
16 scraper containers were healthy. The private Funda `/health` endpoint
returned HTTP 200 from the app VM, and production Alembic reported
`e8c2a1f6b930` as current.

App Postgres confirmed completed ingest batches, beyond initial acceptance:
`645f8887-50ab-441b-b77e-252debec5264` completed at `16:37:15.749 UTC` with two
ingested and five skipped records; `0e35b572-1964-4bf1-bbcf-eebcce2ad3dd`
completed at `16:39:19.389 UTC` with two skipped records. Both had null errors.
The latter contained redundant/legacy rows; no new app observations since the
cohort start were present at this check. Status reported
`latestSuccessfulIngest=2026-09-10T16:38:45.703698+00:00`. These checks establish
continued worker processing, fixed-cohort progress, and completed ingest
delivery without claiming that the existing backlog has finished.

## Services

| Source   | Local repo                                                | VM path                                            | Compose file              | Private API             |
| -------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------- | ----------------------- |
| Funda    | `/home/caslan/dev/git_repos/hh/huishype-funda-scraper`    | `/opt/huishype-scrapers/huishype-funda-scraper`    | `docker-compose.prod.yml` | `http://10.42.0.2:8100` |
| Pararius | `/home/caslan/dev/git_repos/hh/huishype-pararius-scraper` | `/opt/huishype-scrapers/huishype-pararius-scraper` | `docker-compose.yml`      | `http://10.42.0.2:8101` |

Expected containers:

- `huishype-funda-scraper-api-1`
- `huishype-funda-scraper-sync-1`
- `huishype-funda-scraper-scheduler-1`
- `huishype-funda-scraper-worker-1`
- `huishype-funda-scraper-candidates-1`
- `huishype-funda-scraper-probe-1`
- `huishype-funda-scraper-postgres-1`
- `huishype-funda-scraper-redis-1`
- `huishype-pararius-scraper-api-1`
- `huishype-pararius-scraper-sync-1`
- `huishype-pararius-scraper-scheduler-1`
- `huishype-pararius-scraper-worker-1`
- `huishype-pararius-scraper-candidates-1`
- `huishype-pararius-scraper-probe-1`
- `huishype-pararius-scraper-postgres-1`
- `huishype-pararius-scraper-redis-1`

## Status Checks

Load the operator env locally:

```bash
cd /home/caslan/dev/git_repos/hh/huishype
set -a
source .env.scraper-deploy
set +a
```

Check VM and containers:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" hostname
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" 'docker ps --format "{{.Names}} {{.Status}} {{.Ports}}"'
```

Check source-service health from the app/prod VM path:

```bash
ssh root@94.130.105.129 'curl -fsS http://10.42.0.2:8100/health'
ssh root@94.130.105.129 'curl -fsS http://10.42.0.2:8101/api/v1/health'
```

Check authenticated source-service status:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  set -a
  source /opt/huishype-scrapers/huishype-funda-scraper/.env.production
  set +a
  curl -fsS -H "Authorization: Bearer ${API_KEY}" "http://${SCRAPER_API_BIND_IP}:8100/api/v1/status"
'

ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  set -a
  source /opt/huishype-scrapers/huishype-pararius-scraper/.env
  set +a
  curl -fsS -H "Authorization: Bearer ${API_KEY}" "http://${API_HOST_BIND}:8101/api/v1/status"
'
```

The `/api/v1/status` responses are owned by the individual scraper/source-service
repos, not by the HuisHype app API. The app API currently only consumes source
observations and exposes app health under `/health`; do not add a compatibility
breaking app route for scraper diagnostics here.

Both status responses also expose `operationalStatus`, `services`, `freshness`,
`upstream.capabilities`, and priority-level `queue` counts. Treat top-level
`status=degraded` as authoritative when a producer heartbeat is missing, a
capability is open/recovering, or available mirror observations are stale. The
unauthenticated health routes remain shallow infrastructure liveness only.

### Funda Freshness Policy And Recovery Progress

New-listing discovery and polling retain their independent intervals. Existing
available listings first seen or changed within the last seven days are due
after 24 hours without a source observation; older unchanged listings are due
after 168 hours. `freshness.staleCount` and the scheduler use the same policy,
and `freshness.policy` exposes its effective settings:

| Setting | Value | Purpose |
| --- | --- | --- |
| `RECENT_LISTING_WINDOW_DAYS` | `7` | Window for recently added or changed listings |
| `RECENT_LISTING_REFRESH_HOURS` | `24` | Recent-listing refresh deadline |
| `STABLE_LISTING_REFRESH_HOURS` | `168` | Older unchanged listing refresh deadline |
| `UPDATE_SCHEDULE_INTERVAL_MINUTES` | `15` | Interval between update queue top-ups |
| `UPDATE_BATCH_SIZE` | `100` | Maximum jobs added or reused per top-up |
| `UPDATE_MAX_OUTSTANDING_JOBS` | `1000` | Outstanding-job threshold for new update additions |

`UPDATE_INTERVAL_HOURS` is deprecated and ignored. The 15-minute scheduling
interval is distinct from the daily/weekly refresh deadlines. Each top-up uses
global oldest-first selection across all towns, including towns outside the
discovery list, reserving up to a quarter of the batch for recently added or
changed due listings. New update additions pause when pending + processing +
deferred jobs reach the configured threshold. Other producers are not capped
by this update limit. Existing jobs, reservations, worker pacing, and upstream
circuits remain intact.

Rolling freshness counts can rise again as listings age. For cumulative checks
against a fixed population, initialize a named recovery cohort explicitly after
applying migrations:

```bash
cd /opt/huishype-scrapers/huishype-funda-scraper
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python -m scraper.refresh_recovery --name recovery-YYYYMMDD
```

Reusing a name is idempotent. A new name captures a new baseline from listings
available at that moment. The status endpoint's separate `recovery` object
reports the latest cohort's `totalListings`, `checkedListings`,
`remainingListings`, and `progressPercent`. A member counts as checked once
its persisted `last_seen_at` is at or after the fixed `startedAt`, including
unchanged listings and those subsequently marked sold or withdrawn. New
discoveries do not change the denominator, and aging does not undo a completed
check. Status reads never create or reset a cohort. Cohorts persist in Postgres;
restore cohort and listing tables together if a database rollback is needed.
A code-only rollback can leave these additive tables in place.

### Pararius Throttle And Refresh Fields

The Pararius source-service status must expose these operator-visible fields:

- `upstream_throttle.active`
- `upstream_throttle.blocked`
- `upstream_throttle.cooling_down`
- `upstream_throttle.cooldown_until`
- `upstream_throttle.seconds_remaining`
- `upstream_throttle.consecutive_block_count`
- `upstream_throttle.total_block_count`
- `upstream_throttle.last_blocked_at`
- `upstream_throttle.last_success_at`
- `upstream_throttle.last_block_error`
- `available_stale_count`
- `oldest_available_last_seen_at`
- `refresh_backlog_count`
- `refresh_backoff_count`
- `refresh_leased_count`
- `recent_terminal_transitions`

Treat `upstream_throttle.cooling_down = true`, increasing
`upstream_throttle.consecutive_block_count`, increasing `refresh_backoff_count`,
a nonzero `refresh_backlog_count` that does not drain, or an old
`oldest_available_last_seen_at` as evidence that the Pararius mirror is being
throttled, blocked, or under-provisioned. If these fields are missing from the
JSON response, fix/deploy the Pararius scraper repo and then re-run this check;
do not add a HuisHype app API compatibility route for scraper diagnostics.

## Logs

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 scheduler worker sync api
'

ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose logs --tail=200 scheduler worker sync api
'
```

## Queue And Data Checks

Funda:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
    psql -U scraper -d funda_mirror -c "SELECT COUNT(*) FROM listings;"
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:high
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:normal
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:low
'
```

Pararius:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  set -a
  source .env
  set +a
  docker compose exec -T postgres psql -U scraper -d pararius_mirror -c "SELECT COUNT(*) FROM listings;"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:high"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:normal"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:low"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli --scan --pattern \"*backoff*\""
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    WITH listing_rows AS (
      SELECT to_jsonb(l) AS row_json
      FROM listings l
    )
    SELECT
      COUNT(*) FILTER (WHERE row_json->>'status' = 'available') AS available_count,
      MIN((row_json->>'last_seen_at')::timestamptz)
        FILTER (WHERE row_json->>'status' = 'available' AND row_json ? 'last_seen_at')
        AS oldest_available_last_seen_at,
      COUNT(*) FILTER (
        WHERE row_json->>'status' = 'available'
          AND row_json ? 'last_seen_at'
          AND (row_json->>'last_seen_at')::timestamptz < now() - interval '24 hours'
      ) AS stale_available_24h_count,
      COUNT(*) FILTER (WHERE row_json->>'status' IN ('rented', 'withdrawn', 'not_found')) AS terminal_count
    FROM listing_rows;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT to_jsonb(l) AS sentinel_5104ad06
    FROM listings l
    WHERE to_jsonb(l)::text ILIKE '%5104ad06%'
    LIMIT 5;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT
      id,
      pararius_id,
      listing_url,
      status,
      last_seen_at,
      last_changed_at,
      refresh_last_success_at,
      next_refresh_at,
      refresh_error_count,
      refresh_last_error,
      refresh_next_attempt_at,
      refresh_lease_expires_at
    FROM listings
    WHERE pararius_id = '5104ad06'
       OR listing_url ILIKE '%5104ad06%'
    ORDER BY last_changed_at DESC NULLS LAST, updated_at DESC NULLS LAST;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT
      h.id,
      h.change_type,
      h.old_value,
      h.new_value,
      h.recorded_at
    FROM listing_history h
    JOIN listings l ON l.id = h.listing_id
    WHERE l.pararius_id = '5104ad06'
       OR l.listing_url ILIKE '%5104ad06%'
    ORDER BY h.recorded_at DESC
    LIMIT 20;
SQL
REMOTE
```

Sentinel `5104ad06` audit criterion: the sentinel is healthy only when the
mirror has a row for that source ID/URL and the row has a fresh
`last_seen_at`, or a terminal `status` (`rented`, `withdrawn`, or `not_found`)
with a matching recent `listing_history` status change and `last_changed_at`.
If it remains `available` while `last_seen_at` is older than the configured
update interval and `refresh_backoff_count` is nonzero, treat the repair drain
as incomplete.

Main app ingest state:

```bash
ssh root@94.130.105.129 bash -s <<'REMOTE'
  postgres_container="$(docker ps --format "{{.Names}}" | grep -m1 postgres)"
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT source_name, status, verification_state, COUNT(*), MAX(updated_at)
    FROM canonical_listings
    WHERE source_name IN ('funda', 'pararius')
    GROUP BY source_name, status, verification_state
    ORDER BY source_name, status, verification_state;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      COUNT(*) FILTER (WHERE status = 'active') AS active_pararius_count,
      MIN(last_mirror_seen_at) FILTER (WHERE status = 'active') AS oldest_active_last_mirror_seen_at,
      COUNT(*) FILTER (
        WHERE status = 'active'
          AND last_mirror_seen_at < now() - interval '24 hours'
      ) AS stale_active_24h_count
    FROM canonical_listings
    WHERE source_name = 'pararius'
      AND verification_state <> 'invalid';
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT source_status, COUNT(*), MAX(observed_at) AS latest_observed_at
    FROM listing_observations
    WHERE source_name = 'pararius'
      AND source_status IN ('rented', 'withdrawn', 'not_found')
      AND observed_at >= now() - interval '7 days'
      AND stale_for_projection = false
    GROUP BY source_status
    ORDER BY source_status;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      source_name,
      primary_source_listing_id,
      canonical_url,
      status,
      status_source,
      verification_state,
      last_mirror_seen_at,
      updated_at
    FROM canonical_listings
    WHERE source_name = 'pararius'
      AND (
        primary_source_listing_id = '5104ad06'
        OR canonical_url ILIKE '%5104ad06%'
        OR display_url ILIKE '%5104ad06%'
      )
    ORDER BY updated_at DESC;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      id,
      source_name,
      primary_source_listing_id,
      canonical_url,
      display_url,
      status,
      status_source,
      verification_state,
      last_mirror_seen_at,
      updated_at
    FROM canonical_listings
    WHERE id = 'fe190439-443e-49c1-a69c-026092f9055a';
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      id,
      canonical_listing_id,
      source_name,
      source_status,
      observed_at,
      stale_for_projection,
      source_url_raw,
      source_url_canonical
    FROM listing_observations
    WHERE canonical_listing_id = 'fe190439-443e-49c1-a69c-026092f9055a'
    ORDER BY observed_at DESC
    LIMIT 20;
SQL
REMOTE
```

Canonical listing `fe190439-443e-49c1-a69c-026092f9055a` verification
criterion: the canonical row should point at Pararius source identity
`5104ad06` in `primary_source_listing_id`, `canonical_url`, or `display_url`;
`status`, `status_source`, `verification_state`, and `last_mirror_seen_at` must
match the latest non-stale Pararius observation. A terminal mirror result should
be visible in `listing_observations` with `stale_for_projection = false` before
the canonical row is considered repaired.

## Pararius Repair Drain

Use this flow when Pararius available listings are stale or the source-service
status shows refresh backlog/backoff. These runtime knobs belong to the
Pararius scraper VM `.env`, not to the HuisHype app/prod environment.

1. Pause automatic expansion so repair work drains predictably:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  cp .env ".env.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  python3 - <<'PY'
from pathlib import Path

path = Path(".env")
lines = path.read_text().splitlines()
updates = {
    "BOOTSTRAP_MODE": "false",
    "REQUEST_DELAY_SECONDS": "8",
    "REQUEST_DELAY_JITTER_SECONDS": "8",
    "WORKER_CONCURRENCY": "1",
}
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
  docker compose up -d scheduler worker sync api
REMOTE
```

`REQUEST_DELAY_SECONDS=8` and `REQUEST_DELAY_JITTER_SECONDS=8` are the safe
repair-drain target values. If the deployed Pararius scraper build does not yet
read `REQUEST_DELAY_JITTER_SECONDS`, keeping it in `.env` is harmless but it
will not affect behavior until the scraper repo supports that setting. Do not
increase worker concurrency while upstream throttle evidence is present.

2. Enqueue a controlled Eindhoven full-sync:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose exec -T worker python - <<'PY'
from scraper.queue import create_full_sync_job

print(create_full_sync_job("eindhoven", priority="low"))
PY
REMOTE
```

Keep the scope to Eindhoven for the first repair pass. Do not enqueue all-city
or all-country full-sync work until `refresh_backlog_count`, queue lengths, and
terminal transitions show the Eindhoven drain completed without renewed
backoff.

3. Force-refresh the sentinel listing if the full-sync does not settle it:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  set -a
  source /opt/huishype-scrapers/huishype-pararius-scraper/.env
  set +a
  curl -fsS -X POST \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    "http://${API_HOST_BIND}:8101/api/v1/fetch" \
    -d '{"pararius_id":"5104ad06","listing_url":"https://www.pararius.com/apartment-for-rent/eindhoven/5104ad06","priority":"high"}'
REMOTE
```

4. Watch the drain:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose logs --tail=200 -f worker sync api
REMOTE
```

Re-run the authenticated Pararius `/api/v1/status`, Pararius queue/data checks,
and main app ingest checks above. The repair is complete only when the sentinel
`5104ad06` and canonical listing `fe190439-443e-49c1-a69c-026092f9055a` meet
their criteria, queue lengths stop growing, `refresh_backoff_count` is stable or
falling, and the sync service has projected the newest mirror observation into
HuisHype.

## Pararius-Only VM/IP Migration Fallback

Use this only if Pararius remains throttled or blocked after the repair drain.
Do not move Funda unless Funda has independent upstream/IP evidence.

1. Provision a replacement Hetzner VM in the same private network
   (`huishype-private`) with UFW and Hetzner firewall rules equivalent to the
   current scraper VM, but expose only Pararius port `8101` to
   `10.42.0.10/32`.
2. Sync only `/opt/huishype-scrapers/huishype-pararius-scraper` and its
   `.env` to the new VM. Preserve secrets out of tracked docs. Keep
   `BOOTSTRAP_MODE=false`, `REQUEST_DELAY_SECONDS=8`,
   `REQUEST_DELAY_JITTER_SECONDS=8`, and `WORKER_CONCURRENCY=1` for the initial
   drain on the new IP.
3. Restore or migrate the Pararius Postgres volume before starting sync, or run
   a narrowly scoped Eindhoven full-sync first and treat the mirror as degraded
   until coverage is rebuilt.
4. Update app/prod Coolify `PARARIUS_SOURCE_SERVICE_URL` to the new private
   `http://<new-private-ip>:8101` value. Leave
   `FUNDA_SOURCE_SERVICE_URL=http://10.42.0.2:8100` unchanged.
5. Update `.env.scraper-deploy` locally with the new Pararius VM/IP facts, then
   update this runbook's Current Infrastructure and Services tables in a tracked
   commit. Do not commit actual API keys or VM-local `.env` contents.
6. Verify from the app/prod VM:

```bash
ssh root@94.130.105.129 'curl -fsS http://<new-private-ip>:8101/api/v1/health'
```

Then re-run the authenticated Pararius status checks and the main app ingest
checks above. Roll back by restoring the old `PARARIUS_SOURCE_SERVICE_URL` only
if the old VM still has healthier status/backlog behavior.

## Access-Circuit Recovery

The scrapers use persistent Redis circuits: Funda has separate `search` and
`detail` capabilities and Pararius has one `web` capability. Access blocks use
30-minute, 1-hour, 2-hour, 4-hour, 8-hour, then 24-hour cooldowns. When due,
only the `probe` container can obtain the Redis canary lease. Ten consecutive
successful probes are required before a capability becomes healthy. Never use
these controls to bypass App Check, CAPTCHA, Cloudflare, or another WAF.

Pause only upstream-producing Funda roles while preserving APIs, sync, queues,
Redis, Postgres, and mirror data:

```bash
cd /opt/huishype-scrapers/huishype-funda-scraper
docker compose --env-file .env.production -f docker-compose.prod.yml \
  stop scheduler worker candidates
```

Guard capabilities before a deploy or rollback, then start only API and sync.
Start the continuous probe after the explicit one-shot canary so it cannot race
the operator command:

```bash
# Funda
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm \
  probe python -m scraper.probe --guard all --reason deployment_guard
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d api sync

# Pararius
docker compose run --rm probe python -m scraper.probe \
  --guard --reason deployment_guard
docker compose up -d api sync
```

Run one due canary manually. A command reporting `"attempted": false` means a
cooldown or another probe lease is active; do not force another request.

```bash
# Funda search and detail are independent
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm probe \
  python -m scraper.probe --once search
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm probe \
  python -m scraper.probe --once detail

# Pararius Eindhoven search canary
docker compose run --rm probe python -m scraper.probe --once

# Then start the continuous leased probe loops.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d probe
docker compose up -d probe
```

Workers move blocked work to `jobs:deferred:<capability>` without consuming an
attempt or releasing a Funda scheduler uniqueness reservation. The probe loop
returns at most 25 deferred jobs per capability per minute after the circuit is
healthy. Inspect the sets without clearing them:

```bash
redis-cli ZCARD jobs:deferred:search
redis-cli ZCARD jobs:deferred:detail
redis-cli ZCARD jobs:deferred:web
redis-cli ZCARD jobs:failed:index
```

Funda retained access failures must always be previewed before execution. The
execute token binds the action to exactly the jobs shown by the dry run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py recover-access --since 2026-08-20

# Copy DRY_RUN_TOKEN from the unchanged dry-run output.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py recover-access --since 2026-08-20 \
  --execute --dry-run-token '<token>'
```

Filters can be narrowed with repeated `--type` arguments and `--error`. This
command only recovers classified 401/403/429, App Check, CAPTCHA, Cloudflare,
WAF, or access-denied failures and deduplicates by stable job signature. Every
retained match enters the seven-day failed index; only one job per signature is
deferred, and duplicates remain failed and visible in status. It never clears
or bulk-recreates a queue.

After the first canary has recorded circuit state, start the guarded producers
at concurrency one. An open or recovering circuit causes workers to defer jobs
without contacting the source; the scheduler does not advance its timestamps.
Funda's normal delay after recovery is five seconds; Pararius uses an
eight-second delay plus up to eight seconds of jitter:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d scheduler worker candidates
docker compose up -d scheduler worker candidates
```

Before deploy, save `pg_dump -Fc --no-owner --no-acl` backups of both mirror
databases and tag the currently running image IDs. For rollback, guard all
capabilities, stop producers, retag the recorded `pre-recovery-*` images to the
compose image names, start API and sync, run the explicit one-shot canaries, and
only then start the continuous probe. Do not restore a database unless the
deployment changed data incompatibly. Return Funda deferred jobs to their
original priority queues in bounded batches. This also requires an exact dry-run
token and never releases more than 25 jobs per command:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py release-deferred --capability search --limit 25

# Copy DRY_RUN_TOKEN from the unchanged dry-run output.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py release-deferred --capability search --limit 25 \
  --execute --dry-run-token '<token>'
```

Repeat for `detail` only when the prior batch is safely queued. Retained failed
access jobs still use `recover-access`; its execute mode moves them to the
deferred set rather than directly flooding a priority queue.

## Deploy

The live VM runtime directories are not Git working trees. Source changes are
made in the local repos, committed and pushed there, then synced to the VM while
preserving each VM-local env file.

Funda:

```bash
set -a
source /home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
set +a

rsync -az --delete \
  -e "ssh -J root@${APP_VM_PUBLIC_IP}" \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env --exclude .env.production \
  /home/caslan/dev/git_repos/hh/huishype-funda-scraper/ \
  "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}:/opt/huishype-scrapers/huishype-funda-scraper/"

ssh -J "root@${APP_VM_PUBLIC_IP}" "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml build
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
'
```

Pararius:

```bash
set -a
source /home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
set +a

rsync -az --delete \
  -e "ssh -J root@${APP_VM_PUBLIC_IP}" \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env \
  /home/caslan/dev/git_repos/hh/huishype-pararius-scraper/ \
  "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}:/opt/huishype-scrapers/huishype-pararius-scraper/"

ssh -J "root@${APP_VM_PUBLIC_IP}" "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose build
  docker compose up -d
  docker compose ps
'
```

After deploy, run the status, logs, queue, and main app ingest checks above.
