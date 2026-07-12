# Phase 5 Test and Deployment Plan

Date: 2026-07-12

## 1. Validation Baseline

Phase 5 implementation must remain batch-based. Each batch requires local validation before push and separate deployment authorization.

## 2. Backend Validation

Required commands:

```bash
npx prisma validate
npx prisma generate # if schema changes
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand <relevant suites>
```

Required coverage areas:

- public metrics accuracy;
- public data privacy;
- tenant isolation;
- present-location metadata persistence;
- invalid coordinate rejection;
- duplicate detection logic;
- jurisdiction recommendation;
- public success-story approval;
- geographic aggregation;
- provider reputation aggregation;
- no PII leakage.

## 3. Flutter Validation

Required commands:

```bash
flutter analyze
flutter test
flutter build web --release
```

Required coverage areas:

- current-location success;
- permission denied;
- timeout;
- manual fallback;
- accuracy display;
- map pin adjustment;
- location metadata submission;
- chart loading/empty/error states;
- heat-map loading;
- responsive layout at 320px;
- provider geotag capture;
- no location capture without explicit action.

## 4. Website Validation

Required commands:

```bash
npm run build
npm run typecheck
npm run lint
```

Required coverage areas:

- live metrics success;
- API failure fallback;
- stale-data indication;
- success-story rendering;
- public-chart rendering;
- no invalid number display;
- responsive layout;
- environment URL handling.

## 5. Deployment Rules

- Do not deploy until release owner approves.
- Do not run production migrations without an approved migration plan.
- Deploy backend before frontend/website when API contracts change.
- Smoke test public endpoints before switching website live sections.
- Keep static fallback available for website.

## 6. Rollback Strategy

For additive schema changes:

- rollback runtime first;
- keep nullable metadata columns;
- forward-fix if public API contract is wrong.

For website live-data issues:

- rollback website or disable live fetch through configuration;
- static fallback must remain safe.

