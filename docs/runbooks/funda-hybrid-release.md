# Funda hybrid release and acceptance

This runbook coordinates the HuisHype app and Funda source service. The app is
managed by Coolify application `cop1e1822hijj6g3zmxhrs0k`; Funda runs on the
existing scraper VM. Pararius remains an independent source service with its
permanent v1 ingest compatibility. Its existing upstream block is outside this
release, but its containers, database, API and exporter compatibility are release
gates.

## Operator inputs and evidence

Use the gitignored `/home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy`
for infrastructure and source-service credentials. Parse dotenv files as data;
do not execute them as shell programs. In particular, `.env.coolify` contains
characters with shell meaning. Never include credential values or Docker
container environment arrays in a release manifest, terminal output or tracked
artifact.

The read-only pre-release baseline is recorded in
[`../releases/2026-09-13-funda-hybrid/baseline.json`](../releases/2026-09-13-funda-hybrid/baseline.json).
It records the actual running app commit and image IDs, production migration
heads, source health and provider allowance before this milestone. Baselines are
historical evidence, not declarations that the current release is healthy.

The provider dashboard showed 23 of 85,000 credits consumed on 13 September
2026, two active keys, and a reset in 30 days. It did not expose a precise reset
timestamp. Use a conservative whole 31-day essential-work horizon until a
budgeted useful dispatcher request confirms actual replenishment. A displayed
calendar date never resets the durable account ledger.

Keep detailed samples and sensitive backup data outside Git. The final tracked
release manifest contains source commits, immutable image IDs, migration heads,
backup checksums, accounting authority identity, geographic catalog version,
acceptance start/end timestamps and conclusions linked to sanitized evidence.

## Capacity and backup placement

The existing CX23 scraper VM has a fixed 40 GB disk budget. This release must
fit that capacity without a VM resize, an added volume or increased hosting
cost. Account for both scrapers, the independent ledger, retained operational
data, PostgreSQL WAL, images, logs, the operating system and in-flight work;
measure shared filesystem bytes once and preserve operating headroom.

At the baseline, the app VM had 155 GB free and a 79 GB PostgreSQL database;
the scraper VM had 9.4 GB free, with a 1.7 GB Funda mirror and 141 MB Pararius
mirror. The operator workstation had 83 GB free. Check current capacity before
starting any backup or restore. Do not create a full app database clone on the
workstation or scraper VM merely for release verification.

Store fresh compressed custom-format dumps on the app VM under a new
`/var/backups/huishype/funda-hybrid-<UTC timestamp>/` directory with mode 0700.
Use `pg_dump -Fc --no-owner --no-acl` for the app and both mirrors. Stream mirror
dumps over SSH to the app VM so scraper disk is not consumed by duplicate
archives. Verify each dump's exit status, `pg_restore --list` output and SHA-256.
Copy the compressed archives and checksums to a mode-0700 local backup directory
when the measured resulting size fits; compare checksums after transfer.

Validate restores using an isolated database on a capacity-safe host. Restore
schema and the migration journals, source identity tables, observation/outbox
state, lifecycle projections and affected price/scoring tables; run referential
and row-count checks against the corresponding dump snapshot. Full mirror
restores fit independently of the app database. A partial app restore must be
identified explicitly as selected-table restore verification, never a full
restore proof.

Record and preserve all currently running application image IDs before image
cleanup. Retag or export the recorded images as immutable rollback artifacts,
verify the exported archives, and do not prune an image needed by a running
container or the release rollback. Never delete unrelated backups, volumes or
operator files to create space.

The RealtyAPI accounting database has its own PostgreSQL service, role and named
volume. Its accounting state is backed up and audited independently. Mirror or
app rollback must never restore an older accounting snapshot: uncertain paid
requests remain charged. A disaster recovery of accounting requires provider
allowance reconciliation before dispatch resumes.

Include the authority in every later scraper-host maintenance inventory,
even when it was provisioned before the source cutover. Record the independent
`huishype-funda-scraper_realtyapi-ledger-data` volume, current schema fingerprint,
account and period IDs, cumulative spend, registered key fingerprints, immutable
dispatcher image, and the private mounted configuration. Back up the ledger with
its own custom-format dump and protect configuration archives as credentials
(mode-0700 parent directory, mode-0600 files). Verify the dump TOC and checksums
off-host. Once any paid work has occurred, quiesce admission and settle or
conservatively reconcile every in-flight request before taking a fresh authority
backup. The initial zero-attempt backup is historical evidence, not a rollback
point for later accounting.

This milestone already provisioned and initialized the permanent authority at
private schema V4, with ordinary work disabled and no new attempts. At final
cutover, inspect its actual account, period, key registry and cumulative counters,
then apply the verified V4-to-V5 migration to that same volume. Confirm those
identities and counters are preserved before starting the final dispatcher.
Never rerun account initialization or substitute a fresh ledger because the
source image changed. The fresh-account initialization procedure applies only
when an independently checked authority database has no account.

The full app rehearsal uses a dedicated PostgreSQL container and volume on the
app VM, without public ports or application workers. Cap the new compressed dump
at 24 GiB; verify its off-host copy before removing only that newly generated
remote archive to make restore space. Preserve historical backups. During the
isolated full restore, migrations and identity reconciliation, abort only the
rehearsal writers if available disk reaches 48 GiB or available memory falls below
4 GiB. Bound the rehearsal volume to a 96 GiB budget and restore with one job.
Record snapshot invariants, migration results, the first completed reconciliation
checkpoint and its repeat no-op. A live-writer rehearsal backup does not replace
the fresh stopped-writer backups at cutover.

If the isolated rehearsal is still using app-host space at cutover, stream the
new stopped-writer dumps directly to protected off-host storage. Recheck actual
archive sizes, local capacity experiments and peak restore usage first; reserve
at least 20 GiB on the workstation after all bounded backups, in addition to the
app-host guards above. Do not overlap a new backup with an unmeasured capacity
experiment. Verify checksums and restore proof before target migrations. After
all required rehearsal migrations and reconciliation proofs complete, remove
only the owned rehearsal clone if needed to retain a second verified backup
copy on the app host. Keep the rehearsal and final-backup identities distinct.

## Bootstrap evidence cohort

Use current-eligible unique listing identities as the initial missing-confirmation
cohort. Only a completed national sale-and-rent inventory union whose observations
are newer than the cohort's positive evidence may establish a missing identity.
Rows with positive evidence older than the 30-day availability eligibility limit
retain their facts and history but do not become a blanket paid detail backlog
solely because the legacy mirror still calls them available. Actual newer
positive inventory observations restore eligibility under normal ordering rules.
Migration timestamps never refresh a listing.

This is an application of the product's evidence and display policy, not a cost
adjustment. Record initial cohort size, expired historical rows, the completed
inventory union and the resulting missing/essential-address work in the release
manifest. Replace preliminary demand uncertainty with measured final workload;
never lower an unmeasured turnover estimate just to fit the allowance. The
pre-release measurement and limitations are in
[`demand-baseline.json`](../releases/2026-09-13-funda-hybrid/demand-baseline.json).

The read-only [duplicate address audit](../releases/2026-09-13-funda-hybrid/duplicate-address-audit.json)
classifies global-ID collisions by complete normalized property address and
transaction, not legacy address row IDs. It found 3,277 otherwise safe duplicate
groups split only by the legacy `buy`/`sale` spelling difference; both spellings
must normalize to sale. Distinct complete addresses and incomplete evidence
remain separate quarantine cases. The accompanying SQL preserves the exact
normalization used for that historical measurement.

## Coordinated release order

1. Complete implementation tests, real PostgreSQL concurrency checks, Compose
   validation and offline geographic coverage verification. Build immutable
   images and record their source commits and IDs. Live mapping, sizing and
   throughput validation use the final migrated planner later in this sequence.
2. Disable Coolify automatic deployment and verify the stored application
   setting. Cancel or finish queued deployments before pushing either final main
   branch. The baseline setting was enabled; pushing main without this fence can
   deploy an app image before its coordinated migration window.
3. Stop the old Funda API, scheduler, worker, candidates, probe and sync containers.
   Allow already accepted Funda app-ingest batches to finish while the old app API
   and worker remain running. Record the durable `accepted`, `queued`,
   `processing` and `retryable` counts and require that active set to drain before
   stopping the app API and worker. Historical terminal `failed` records are a
   separate audit population: preserve their rows and payloads, classify their
   errors and later evidence, and record a reviewed disposition. Do not delete or
   relabel them merely to produce a zero failure count. Preserve databases,
   Redis, Photon and Pararius infrastructure. Pause Pararius export during the
   app outage, preserving its durable unsent observations. Record the retired
   source Redis jobs and v1 outbox state; no old payload may execute under the new
   writer generation.
4. Take the fresh verified backups with writers stopped. Capture the last old
   writer generation and outbox state. Never timestamp retained listing evidence
   with migration time.
5. Apply app and source migrations successfully before starting their workers.
   The app migration role also completes the versioned legacy Funda identity
   reconciliation before either API or worker can start.
   App and source Compose dependency gates must enforce migration success on
   every subsequent deployment too. Retire the old Funda writer generation;
   legacy Redis queue entries cannot become new planner work or deliver v1 Funda
   writes after cutover.
6. After the app migration/reconciliation gate succeeds, start the app API,
   worker/web and final Funda API/sync roles using the
   recorded immutable images. Keep ordinary paid work disabled
   while the final planner performs bounded geographic mapping and first-page
   sizing through the private dispatcher. Review the measured full essential-work
   forecast before granting bounded initial inventory or activating normal paid
   operation. Initialize the final geographic catalog, reconcile existing
   identities and replay original observation times through the durable ordered
   outbox. Conflicting property links remain quarantined with explicit counts.
7. Verify running commits, image IDs and all migration heads against the release
   manifest. Verify app health, map/feed/listing projections, source API health,
   planner ownership, outbox age and credit reconciliation. Resume Pararius export
   and confirm that its existing v1 format is accepted.
8. Restore the intended Coolify automatic-deployment policy only after the
   successful release, all acceptance evidence and final documentation pushes are
   complete. Record the final setting in the manifest. Keep automatic deployment
   disabled during the full elapsed-time acceptance collection so documentation
   commits cannot inadvertently restart the measured runtime.

### Retained historical failures and independent URL verification

Preserve the three legacy terminal failed Funda batches as their original audit
records. Indexed per-record checks found exact-clock status/asking-price evidence
and matching global aliases for the 44- and 45-record batches; those checks do
not prove full payload equality or successful original delivery. The 1,000-record
historical import has nine submitted URLs with no proved current app or indexed
source identity coverage. Do not replay their failed v1 payloads as v2 evidence.

The protected `historical-nine-url-verification-inputs-private.json` contains the
nine exact original URLs, expected tiny IDs, fixed batch UUID and input hashes.
At coordinated cutover, freeze its `observed_after` to that actual timestamp.
After the final authority and planner have capacity to meet mandatory URL
verification deadlines, enqueue all nine through the supported final source
resolver and durable `url_validation` work, preserving the same batch UUID and
cutoff on retries. The final planner and dispatcher own acquisition. Do not enqueue
them during the initial geography-only grant, which cannot admit paid details,
and do not copy legacy facts, property hints or timestamps into fresh evidence.
Record the nine real outcomes and any resulting identity/quarantine decisions
before the milestone closes. Keep URLs and raw outcomes private; publish only
aggregate completion/disposition evidence. Their old terminal failure records
remain intact regardless of the new verification result.

### Legacy identity reconciliation and source replay

Drizzle migrations create the identity, audit and reconciliation checkpoint
tables. The Compose migration role then runs the compiled operator script using
only its production `DATABASE_URL`:

```bash
node services/api/dist/scripts/reconcile-source-identities.js --source funda --execute --once
```

Both API and worker depend on the successful completion of this role. A failed
schema migration or reconciliation prevents startup. The reconciliation and its
versioned completion checkpoint commit atomically under the source lock; later
deployments no-op against that completed version. The startup report contains
aggregate counts and checkpoint state. Preserve that execution report privately.
For an explicit read-only plan after migrations, run the same script with
`--source funda` and without `--execute`; preserve any conflict samples privately.
Complete reconciliation audit details remain in the database.

Create the evidence directory with mode0700 and use umask077 before saving
reports. Record aggregate canonical/legacy row counts,
identity groups, duplicate groups, survivors, quarantines by reason, observation
links and audit rows before and after execution. Require successful exit and
verify that safe aliases share their surviving identity, conflicting property
links remain quarantined, and original observation times/history are preserved.
Do not continue to replay after an incomplete or failed reconciliation.

Start the app worker and final source API/sync roles after reconciliation. The
source sync role enumerates replay members in bounded pages and advances its
ordered outbox only after app processing receipts. Replay does not require the
acquisition planner/worker loops or any provider request.

Use the supported operator CLI from the finalized app checkout; the production
API image does not package `services/api/scripts/seed-listings.ts`. Load the
operator environment as data, including `FUNDA_SOURCE_SERVICE_URL` and
`FUNDA_SOURCE_SERVICE_API_KEY`, and independently verify the production app
export target against deployment configuration. Persist one UUID for the entire
handoff, including any retry:

```bash
pnpm --filter @huishype/api db:seed-listings -- --source funda --app-api-url "$EXPECTED_APP_API_URL" --request-id "$REPLAY_REQUEST_ID" --dry-run > "$PRIVATE_EVIDENCE/funda-replay-plan.json"
pnpm --filter @huishype/api db:seed-listings -- --source funda --app-api-url "$EXPECTED_APP_API_URL" --request-id "$REPLAY_REQUEST_ID" > "$PRIVATE_EVIDENCE/funda-replay-submission.json"
```

The CLI validates the source's export target and writer generation, submits a
durable v2 replay, and reads it back. It does not copy Funda mirror rows into app
tables. Submission is not completion: monitor the authenticated
`GET /source/replays/<request ID>` until `status=completed`, and record eligible,
processed, queued and delivered counts plus the final sequence and generation.
Require every replay record to have a completed app receipt and retain original
evidence timestamps. Drain app price repair, expiry and property/tile queues
before starting the acquisition acceptance window.

Create the build context from the frozen full source SHA, including its pinned
`pyfunda` gitlink, using committed Git objects rather than copying a worktree:

```bash
python3 tools/ops/archive-funda-release.py --repository /home/caslan/dev/git_repos/hh/.milestone-worktrees/funda-hybrid --revision "$SOURCE_SHA" --output-dir /private/release-archive
```

Verify the archive SHA-256 after upload and extract into a new
`/opt/huishype-scrapers/releases/<source SHA>/` directory. Build with
`--target production --build-arg SOURCE_REVISION=<source SHA>` and tag
`huishype/funda-scraper:<source SHA>`. The archive helper never includes dirty or
untracked files and refuses to overwrite existing artifacts. Record the image ID
and OCI source revision after the build. Never copy operator env files or secrets
into the Docker build context.

The independent authority can be provisioned before the maintenance window using
only `ledger-postgres`, `ledger-migrate` and `dispatcher` from the final Compose
project and immutable image. Geography calibration waits for the final migrated
source planner during maintenance; it does not use a parallel calibration
database or an independent collector. Initialize with the explicitly approved
1,000-credit useful-calibration ceiling and keep ordinary work disabled until the
complete essential workload forecast fits. Initial full inventory needs its own
measured bounded authorization after geographic first-page sizing. Keep normal
planner/worker loops stopped during the bounded geography/sizing one-shot CLI
steps, with direct acquisition disabled. After a reviewed finite inventory
measurement grant, run the final loops: measurement inventory stays assigned to
RealtyAPI while eligible direct detail, status and probes may run normally.
Ordinary paid operation still requires activation against the whole forecast.
After activation and initial queue drain, disable direct eligibility for the
actual paid-only acceptance cycle.

The image runs as UID/GID 1000. Standalone Compose file secrets preserve host
ownership, so use a root-owned mode-0700 secrets directory with the individually
mounted files mode0400 owned by UID/GID1000. This lets the intended nonroot
containers read their explicit mounts while host directory traversal remains
root-only. Keep ledger credentials in a distinct root-readable operator env file;
never mount paid API keys into planner, worker, sync or API containers.

Use absolute secret paths in the operator env file: relative Compose file paths
resolve from the immutable release directory. Initialization evidence mounted into
the administrator container also needs UID1000 read permission. Start the ledger
database and successful migration first, initialize through a one-shot dispatcher
container, then start the dispatcher service. Initialization commits account,
period, fingerprints and its audit event atomically but is not idempotent. After
an interrupted command, inspect durable state before retrying; never reinitialize
an existing account or reset its counters. Dispatcher startup verifies both schema
and provider-key fingerprints; an `admin status` response alone verifies neither
the secret-file contents nor successful dispatcher startup. Keep acquisition
consumers absent during authority-only provisioning.

Existing provider keys are migrated into the private dispatcher authority. The
unused Primary Key is revoked; the maintained production key is stored only in
the dispatcher secret file. Remove known raw-key copies from manual tool inputs
and retire independent paid-request clients. Maintained manual tools submit work
to the same authenticated dispatcher. Record fingerprints and key names in
attestation, never the secrets themselves. Revocation and secret placement must
be confirmed before spending begins.

## Verification commands

From the app repository, capture a read-only sample and verify Compose migration
failure/success behavior:

```bash
python3 tools/ops/funda-hybrid-evidence.py capture --output-dir /private/release-evidence
python3 tools/ops/check-app-migration-gate.py
python3 -B -m unittest discover -s tools/ops -p 'test_funda_hybrid_evidence.py'
```

The Compose gate check runs isolated short-lived containers under a unique
project name. It verifies that a failed migration prevents API/worker/web startup,
a successful migration permits startup, and an exited migration executes again
when explicitly started. It does not replace the application's actual migration
SQL integration tests. Startup dependencies do not stop already-running old
writers; the maintenance-window writer fence remains required.

Coolify `4.0.0-beta.470` was inspected before release: its Compose parser preserves
`depends_on`, assigns commit-based image tags to services with build directives,
and its status calculator excludes services with `restart: "no"`. The migrate
role builds exactly the API image and has no inherited long-running healthcheck.
It receives only the database settings needed for schema migration and versioned
identity reconciliation. The API
retains its existing search-area rebuild before reporting healthy.

Collect the elapsed cycle and verify immutable runtime identity:

```bash
python3 tools/ops/funda-hybrid-evidence.py watch --output-dir /private/release-evidence --interval 60 --duration-hours 168 --max-output-bytes 2147483648
python3 tools/ops/funda-hybrid-evidence.py verify-window --directory /private/release-evidence --start "$ACCEPTANCE_START_UTC" --end "$ACCEPTANCE_END_UTC" --max-gap-minutes 2 --manifest release.json
python3 tools/ops/funda-hybrid-evidence.py verify-release --manifest release.json --snapshot snapshot.json
```

`watch` writes an owner-readable sample immediately, then minute status/resource
samples and full image/schema samples hourly. Keep it running through the chosen
end; an interrupt captures a final full sample before exiting. The manifest's
`services` maps canonical roles such as `app.api` or `funda.planner` to full
`sha256:` image IDs. Its `code_revisions` maps deployed app/source roles to their
full source commit SHA, verified against an OCI revision label or the full-SHA
Coolify image tag. Digest-only image references cannot establish a source commit. `completed_services` maps `app.migrate`, `funda.migrate` and
`funda.ledger-migrate` to their image IDs and requires an exited-zero result.
`migrations` records the app, Funda, Pararius and independent ledger schema heads.
The ledger head comes from its `realty_schema_revision` journal, including the
source-checked schema fingerprint; `create_all` alone is not a migration proof. A window check
certifies elapsed observation coverage only; inventory, latency and budget
acceptance require the final planner/ledger evidence described below. Every running
recognized service, including infrastructure, must appear in `services`; an
undeclared legacy scheduler fails release verification. Full samples record named
volumes and require stable running images, source commits and migration heads
throughout the observation window, including intermediate hourly samples. Set
`required_metrics: ["app.queues", "app.publications", "app.retention", "funda.evidence", "funda.storage"]` in the
final manifest. These aggregate metrics
are mandatory in every minute sample when `verify-window` receives that manifest;
legacy baselines can omit the requirement. Full samples are also checked against
the manifest throughout the window. Unavailable metrics must be investigated,
including read-only SQL timeouts; they are never zero-length queues.

Reserve 2 GiB for the dedicated local evidence directory in addition to the
20 GiB free-space floor and any unfinished capacity experiment. The default
output budget counts all existing run artifacts, each pending serialized
snapshot and the managed `watch-*.jsonl` journal before writing. Journals are
limited to 4 MiB per run; console output contains only bounded start/end/error
records. Inspect the journal for individual sample progress. Budget exhaustion,
unsafe symlinks or the seven-day maximum stop collection explicitly without
deleting or truncating earlier evidence. Such a stop does not certify an
acceptance interval. Choose and assess the actual interval before raw proof
expires; preserve the sealed aggregate reports and matching private artifacts.
The watcher tooling revision is recorded separately from deployed runtime SHAs.

`app.retention` records database/relation bytes and the latest indexed Funda raw
retirement frontier. It does not scan permanent business history or count all
receipts on each sample. The frontier is raw-data replay fencing, not a delivery
receipt or a positive observation. `funda.storage` requires numeric filesystem
and accepted-completion reserves, admitted intake, capacity checked within two
minutes and successful maintenance within three minutes. Blocked intake,
maintenance errors, a source-prefix pin blocking already-due retirement or stale
capacity fail the required storage gate; ordinary current evidence pins do not. Existing acquisition, queue and publication latency checks remain
independent and mandatory.

## Acceptance evidence

Collect source status, mandatory queue age, completion slots, complete inventory
manifests, outbox delivery lag, collector capability health and account ledger
reconciliation every minute. Record actual UTC timestamps and retain sample
errors. Capture images and migration heads at the beginning, end and after every
deployment. Missing samples or missing coverage metrics cannot be treated as
success.

App maintenance must also make measurable progress. Collect the number and oldest
age of expired `canonical_listings.active_eligible` rows, unrecomputed
`price_evidence_repair_queue` rows, pending `listing_tile_property_updates` rows,
and dirty `listing_tile_updates` rows where `requested_revision` exceeds
`published_revision`. Record expired dirty-tile leases and tile error counts;
retain aggregate evidence without listing records or error text. A running worker
with a growing or stalled maintenance backlog is not a healthy final state.
The normal 30-second recovery sweep drains availability expiry and price repairs,
then publishes bounded listing tile updates. Confirm that cutover repair queues
drain and ongoing updates remain within the freshness contract before beginning
the final acceptance window.

Start collection after cutover queues drain and direct acquisition is disabled.
Choose the acceptance start as the next UTC minute after the initial full sample
completes. Choose a UTC-minute end at least 24 actual hours later, extending
collection until useful paid requests inside the interval span at least 24 hours
and all source, delivery and accounting gates pass. Do not issue requests merely
to pad this proof. The source cycle certificate, ledger report, `verify-window`
and `audit-freshness` must use exactly the same start and end. Record the actual
duration; a longer measured interval must not be described as exactly 24 hours.
Capture a full sample after the selected end before stopping the collector.
The surrounding full samples verify runtime identity; the minute-aligned bounds
define the common evidence interval and retained tile-publication buckets.

A daily acceptance cycle requires at least 24 actual elapsed hours. Unit-test
clocks and accelerated schedules cannot substitute for that observation period.
A healthy `/health` response only establishes process and dependency liveness;
release acceptance also requires a complete national inventory under deadlines,
bounded essential work, ingestion within 15 minutes and a measured remaining
billing-cycle forecast with direct capacity set to zero.

Validate suitable direct and paid assignments in hybrid operation. Then validate
sustained paid-only essential operation with direct eligibility disabled through
the final planner. Both modes use the same work identities, leases, request
controls, normalization, manifests and outbox. Never run a parallel legacy
crawler, an independent paid diagnostic, or faster direct HTTP pacing to force a
passing result. Direct availability is not a release requirement.

During evidence outages, confirm backoff and absence of invented disappearance
or sold/rented facts. Positive availability remains eligible for at most 30 days
from actual source confirmation; explicit newer terminal evidence wins
immediately. Expiry changes active presentation and map/filter projections, not
factual transaction status. Recovery must preserve source observation ordering.

For end-to-end map freshness, use a conservative bound over all completed work:
the maximum actual acquisition-to-app-acknowledgment latency plus the maximum
canonical-mutation-to-tile-publication latency, including property-queue expansion
delay. Canonical mutation precedes acknowledgment, so the sum bounds both stages.
Retain completed-publication maxima even when the same tile is published again,
and include pending acquisition/property/tile ages so unfinished work cannot
vanish from the assessment. Separate historical replay and correlation from actual
new acquisition; neither old source timestamps nor migration times can stand in
for a fresh acquisition. A bound above 15 minutes requires a throughput or
correctness fix before acceptance. Validate the identity-to-property-to-tile link
with a real acquisition sample and label that joined trace as sampled evidence;
it is not an exact universal per-event latency measurement. Audit the explicit
minute-aligned interval using retained source records and publication buckets:

```bash
python3 tools/ops/funda-hybrid-evidence.py audit-freshness --start "$ACCEPTANCE_START_UTC" --end "$ACCEPTANCE_END_UTC" --directory /private/release-evidence --output-dir /private/release-audit --max-latency-seconds 900 --manifest release.json
```

The audit checks completed work and pending acquisition/property/tile ages against
the 15-minute bound, with full samples bracketing the interval and minute coverage
inside it. Its successful result is a freshness proof only; complete geographic
inventory, mandatory deadlines and credit/billing reconciliation remain separate
required evidence.

Assess the exact interval while its start is no more than seven days old. Both
source validation and the ops freshness command reject a newly assessed older
interval whose raw proof may have retired. Preserve the successful source
certificate, ops artifacts, compact ledger report and matching ledger receipt
before operational retirement. The source checkpoint must seal that exact
interval/catalog/source certificate hash with the independent ledger receipt;
a later rolling report cannot replace it. Keep the report plus operator string
within the ledger's 16 KiB limit, referencing full private evidence by hash rather
than embedding raw manifests or request arrays.

The final acceptance record names the observed cycle, mode, complete coverage,
queue/ingest targets, paid forecast and actual credit reconciliation. Do not mark
the milestone complete until changes are on main, deployed, and these facts are
verified against the running release.
