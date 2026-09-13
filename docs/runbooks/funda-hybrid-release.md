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

## Coordinated release order

1. Complete implementation tests, real PostgreSQL concurrency checks, Compose
   validation, complete geographic coverage verification and bounded paid-only
   demand/throughput checks through the final private dispatcher. Build immutable
   images and record their source commits and IDs.
2. Disable Coolify automatic deployment and verify the stored application
   setting. Cancel or finish queued deployments before pushing either final main
   branch. The baseline setting was enabled; pushing main without this fence can
   deploy an app image before its coordinated migration window.
3. Stop the old Funda scheduler, worker, candidates, probe and sync containers.
   Stop the app API and worker during the maintenance window. Preserve databases,
   Redis, Photon and Pararius infrastructure. Pause Pararius export during the
   app outage if necessary, preserving its durable unsent observations.
4. Take the fresh verified backups with writers stopped. Capture the last old
   writer generation and outbox state. Never timestamp retained listing evidence
   with migration time.
5. Apply app and source migrations successfully before starting their workers.
   App and source Compose dependency gates must enforce migration success on
   every subsequent deployment too. Retire the old Funda writer generation;
   legacy Redis queue entries cannot become new planner work or deliver v1 Funda
   writes after cutover.
6. Deploy app API, worker and web and the final Funda API/planner/runtime/outbox
   services using the recorded immutable images. Initialize the final geographic
   catalog, reconcile existing identities and replay original observation times
   through the durable ordered outbox. Conflicting property links remain
   quarantined with explicit operational counts.
7. Verify running commits, image IDs and all migration heads against the release
   manifest. Verify app health, map/feed/listing projections, source API health,
   planner ownership, outbox age and credit reconciliation. Resume Pararius export
   and confirm that its existing v1 format is accepted.
8. Restore the intended Coolify automatic-deployment policy only after the
   successful release, all acceptance evidence and final documentation pushes are
   complete. Record the final setting in the manifest. Keep automatic deployment
   disabled during the full elapsed-time acceptance collection so documentation
   commits cannot inadvertently restart the measured runtime.

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
It receives only the database settings needed for schema migration. The API
retains its existing search-area rebuild before reporting healthy.

Collect the elapsed cycle and verify immutable runtime identity:

```bash
python3 tools/ops/funda-hybrid-evidence.py watch --output-dir /private/release-evidence --interval 60 --duration-hours 24
python3 tools/ops/funda-hybrid-evidence.py verify-window --directory /private/release-evidence --hours 24 --max-gap-minutes 2
python3 tools/ops/funda-hybrid-evidence.py verify-release --manifest release.json --snapshot snapshot.json
```

`watch` writes an owner-readable sample immediately, then minute status/resource
samples and full image/schema samples hourly and at the end. The manifest's
`services` maps canonical roles such as `app.api` or `funda.planner` to full
`sha256:` image IDs. `completed_services` maps `app.migrate`, `funda.migrate` and
`funda.ledger-migrate` to their image IDs and requires an exited-zero result.
`migrations` records the app, Funda and Pararius schema heads. A window check
certifies elapsed observation coverage only; inventory, latency and budget
acceptance require the final planner/ledger evidence described below.

## Acceptance evidence

Collect source status, mandatory queue age, completion slots, complete inventory
manifests, outbox delivery lag, collector capability health and account ledger
reconciliation every minute. Record actual UTC timestamps and retain sample
errors. Capture images and migration heads at the beginning, end and after every
deployment. Missing samples or missing coverage metrics cannot be treated as
success.

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

The final acceptance record names the observed cycle, mode, complete coverage,
queue/ingest targets, paid forecast and actual credit reconciliation. Do not mark
the milestone complete until changes are on main, deployed, and these facts are
verified against the running release.
