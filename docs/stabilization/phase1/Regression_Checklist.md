# Phase 1 Regression Checklist

Date: 2026-07-09

## Backend Gate

- [x] `npx prisma validate`
- [x] `npx prisma generate`
- [x] `npm run build`
- [x] `npm test -- --runInBand`
- [x] `npm run test:e2e -- --runInBand`

## Flutter Gate

- [x] `flutter analyze`
- [x] `flutter test`
- [x] `flutter build web --release`

## Website Gate

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Role Smoke Tests

- [ ] Citizen login.
- [ ] Provider login by email/password.
- [ ] Provider login by provider ID/password.
- [ ] Org admin login.
- [ ] Dispatch login.
- [ ] Super admin login.

## Workflow Smoke Tests

- [ ] Citizen submits report with evidence.
- [ ] Admin/dispatch assigns provider.
- [ ] Provider accepts.
- [ ] Provider rejects with reason.
- [ ] Dispatch reassigns.
- [ ] Assignment timeout job/path verified.
- [ ] Provider completes with evidence.
- [ ] Citizen confirms completion.
- [ ] Citizen marks work incomplete and admin receives review path.
- [ ] Report closes correctly.

## Tenant Isolation Smoke

- [ ] Org A cannot see Org B reports.
- [ ] Org A cannot assign Org B provider.
- [ ] Provider A cannot update Provider B job.
- [ ] Citizen A cannot see Citizen B reports.
- [ ] Super admin global access remains explicit.

## Mobile Smoke

- [ ] Android Pixel width.
- [ ] 360px browser width.
- [ ] 390px browser width.
- [ ] 430px browser width.
- [ ] Admin Providers no overflow.
- [ ] Platform Tools no overflow.
- [ ] Dispatch command center no overflow.
- [ ] Bottom navigation and More sheet no overlap.

## Production Safety

- [x] No work on production branches.
- [x] No tag push.
- [x] No deploy.
- [x] No environment changes.
- [x] No database changes outside reviewed migrations.
