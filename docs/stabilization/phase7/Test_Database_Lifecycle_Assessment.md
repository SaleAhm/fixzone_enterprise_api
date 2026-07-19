# Test Database Lifecycle Assessment

Date: 2026-07-16

## Current lifecycle model

The backend Jest and e2e suites use the configured Prisma database directly. Test files generally create Nest application instances in `beforeAll`, create fixtures through Prisma or HTTP requests, and clean up fixtures in `afterEach` or `afterAll`.

There is no per-suite database clone, transaction rollback harness, or global truncate/reset between every test file.

## Unit and e2e database behavior

- `npm test -- --runInBand` runs suites sequentially within one Jest process.
- `npm run test:e2e -- --runInBand` runs e2e suites sequentially within one Jest process.
- Running those two commands at the same time is unsafe because both processes share the same database and fixture namespaces.

## Migration process

Phase 7B-A did not add, remove, or run migrations. Prisma schema validation and client generation passed.

## Seeding

No production or test seed changes were made. Test fixtures are created inside individual suites.

## Cleanup findings

### Auth suite

Before Phase 7B-A, auth cleanup missed:

- `provider1@fixzone.ng`;
- updated citizen phone values;
- login history rows;
- notifications tied to test users/reports;
- compliance audit rows;
- invitation rows by fixture email.

### Report workflow suite

Before Phase 7B-A, report workflow cleanup depended on in-memory arrays. Interrupted or overlapped runs could leave:

- `wf-*` users;
- `Workflow *` organizations;
- `WF *` reports;
- compliance audit rows;
- notification rows;
- `uploads/report-completion/<reportId>` directories.

## Sequence reset

The schema uses cuid-style IDs, so sequence reset was not required for this tranche.

## Interrupted test behavior

Interrupted or concurrent runs can bypass `afterEach`/`afterAll` cleanup. Phase 7B-A added prefix-based cleanup at suite startup for the report workflow suite and broader cleanup in the auth suite.

## Recommended stable pattern

1. Keep full backend validation sequential.
2. Avoid running `npm test` and `npm run test:e2e` concurrently against the same database.
3. Prefer fixture namespaces by suite prefix.
4. Clean by fixture prefix in `beforeAll` as well as `afterEach`/`afterAll`.
5. Remove filesystem artifacts created by upload tests.
6. Keep production code free of test reset logic.

