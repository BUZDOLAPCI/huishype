# Fresh CI test fixtures

CI creates its own PostgreSQL and Redis containers. After real migrations it runs
`db:seed-ci-fixture`, then the unchanged canonical `pnpm test` gate. PostgreSQL is
removed in an `always()` cleanup step; GitHub Actions owns Redis teardown. No
production, development, BAG, or scraper database supplies test data.

The bootstrap requires `NODE_ENV=test`,
`PLAYWRIGHT_ALLOW_CI_DATABASE_FIXTURE=1`, an explicit local `DATABASE_URL`, and an
exact `--database-name` ending in `_test`. It checks the connected database,
database user and server address, rejects production/development names and
nonfixture property/user/listing data, and never runs implicitly during normal
application startup. Its three synthetic Eindhoven properties are shared with
the existing test fixture definitions in
`scripts/playwright/property-tile-fixture.mjs`. Each has a real canonical listing
with explicit asking-price units and positive availability. The northern property
covers the address test's bounding box. The seed also initializes location-search
areas and listing read models. Repeating the bootstrap before the tests preserves
its existing rows.

Optional decorative import tables remain absent. The real tile endpoints must
handle unavailable imports; the seed does not conceal missing-import behavior.

`PLAYWRIGHT_PHOTON_FIXTURE=1` enables a loopback Photon provider fixture owned by
the browser harness. Only this external HTTP dependency is simulated: browser
requests still reach the real app geocoding API and all existing UI assertions
remain active. The fixture serves known geographic response shapes and rejects
unsupported requests. The harness starts and stops it with the API/web processes,
including failure and signal cleanup. Normal development retains its configured
Photon service.

To reproduce on a dedicated local database, create disposable services, then run
from the repository root:

```bash
docker run -d --name huishype-ci-postgres -e POSTGRES_USER=huishype -e POSTGRES_PASSWORD=fixture_only -e POSTGRES_DB=huishype_test -p 127.0.0.1:55443:5432 postgis/postgis:16-3.4
docker run -d --name huishype-ci-redis -p 127.0.0.1:56393:6379 redis:7-alpine
export DATABASE_URL=postgresql://huishype:fixture_only@127.0.0.1:55443/huishype_test
export REDIS_URL=redis://127.0.0.1:56393/0
export NODE_ENV=test
export PLAYWRIGHT_ALLOW_CI_DATABASE_FIXTURE=1
export PLAYWRIGHT_PHOTON_FIXTURE=1
docker exec -e PGPASSWORD=fixture_only huishype-ci-postgres psql -X -h 127.0.0.1 -U huishype -d huishype_test -v ON_ERROR_STOP=1 -Atqc 'SELECT PostGIS_Full_Version()'
docker exec huishype-ci-redis redis-cli ping
pnpm --filter @huishype/api db:migrate
pnpm --filter @huishype/shared build
pnpm --filter @huishype/api db:seed-ci-fixture --database-name huishype_test
pnpm test
```

Wait until both readiness commands succeed before migrating. The PostgreSQL
check uses the final TCP server and actual PostGIS function, because the image's
temporary initialization server can accept Unix-socket probes too early. After success or
failure, remove only these disposable services:

```bash
docker rm -f huishype-ci-postgres huishype-ci-redis
```
