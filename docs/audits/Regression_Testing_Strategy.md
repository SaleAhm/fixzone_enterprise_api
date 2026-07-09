# Regression Testing Strategy

Date: 2026-07-09

## Objective

Prove that milestone integration preserves production behavior across backend, Flutter, website, database, workflows, security and deployment.

## Backend Tests

Required commands:

```powershell
npx prisma validate
npx prisma generate
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Required coverage:

- Auth login for citizen, provider, org admin, dispatch and super admin.
- Provider login by email/password.
- Provider login by provider ID if supported.
- Password reset stores bcrypt hash and allows login.
- Organization scoping for reports/providers/users/analytics.
- Report creation.
- Assignment lifecycle.
- Provider acceptance.
- Provider completion.
- Citizen validation.
- Notification creation.
- Audit log creation.
- Platform module APIs remain read/configuration-only for future modules.
- Future modules stay locked/metadata-only.

## Frontend Tests

Required commands:

```powershell
dart format .
flutter analyze
flutter test
flutter build web --release
```

Required coverage:

- AuthGate routing.
- Citizen flow.
- Provider login and dashboard routing.
- Admin mobile navigation.
- Admin More menu.
- Platform Tools panel rendering.
- Organizations screen rendering.
- Providers screen rendering.
- Module access locked/allowed/hidden states.
- Responsive layout tests.

## Website Tests

Required commands:

```powershell
npm run typecheck
npm run lint
npm run build
```

Recommended checks:

- Lighthouse.
- Keyboard navigation.
- Responsive mobile/tablet/desktop.
- SEO metadata.
- Contact form behavior.

## Workflow Tests

Manual and automated:

1. Citizen submits report with evidence.
2. Organization admin/dispatch reviews report.
3. Dispatch assigns provider.
4. Provider accepts.
5. Provider marks in progress where supported.
6. Provider uploads completion evidence.
7. Citizen validates completion.
8. Report closes.
9. Notifications appear for relevant users.
10. Audit trail includes key events.
11. Super admin analytics/platform state updates.

## API Tests

Validate:

- No existing production endpoint changes response shape unexpectedly.
- Auth endpoints return expected tokens/roles.
- Report list/detail endpoints remain compatible.
- Upload endpoints accept expected payloads and reject oversized/invalid payloads.
- New module/config endpoints are additive.

## Database Tests

Validate:

- Prisma schema validates.
- Migrations apply cleanly in staging.
- Seed data remains compatible.
- Provider password hashes are valid.
- Provider public IDs remain clean.
- Organization enabled module metadata does not break current tenants.

## Security Tests

Validate:

- 401/403 behavior.
- Role boundary tests.
- Organization isolation tests.
- Upload validation.
- Login failure logging.
- Sensitive routes require auth.
- Future modules cannot be accessed as active workflows.

## Performance Tests

Recommended:

- Dashboard load with large report dataset.
- Organization list with many tenants.
- Providers screen with many providers.
- Report details with evidence images.
- API response time smoke under moderate load.

## UAT

Required users:

- Citizen.
- Provider.
- Organization admin.
- Dispatch officer.
- Super admin.

Required devices:

- Desktop Chrome.
- Mobile Chrome Android 360-430px.
- Tablet width.
- Flutter web release build.

## Production Smoke Tests

After deployment:

- Login all roles.
- Submit one test report.
- Assign and complete one test report.
- Validate completion.
- Upload/view evidence.
- Open Platform Tools.
- Open Organizations.
- Open Providers.
- Check notifications.
- Check audit logs.
- Confirm no mobile overflow warnings in manual Android QA.

