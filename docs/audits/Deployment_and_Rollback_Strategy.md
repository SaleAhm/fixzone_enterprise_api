# Deployment and Rollback Strategy

Date: 2026-07-09

## Deployment Strategy

Use staged deployment only.

### Stage 1: Pre-Deployment

- Freeze production changes.
- Confirm Baseline A tags.
- Confirm Baseline B tags.
- Confirm database backup.
- Confirm environment variables.
- Confirm migration plan.
- Confirm rollback owner.

### Stage 2: Staging Backend

- Deploy backend RC.
- Run Prisma migrate deploy in staging.
- Run health checks.
- Run backend smoke tests.

### Stage 3: Staging Frontend

- Deploy Flutter web RC.
- Verify API base URL.
- Run role login smoke.
- Run workflow smoke.
- Run mobile layout smoke.

### Stage 4: Website

Deploy only if website changes are included.

- Build.
- Deploy.
- Check navigation, forms and SEO basics.

### Stage 5: Production Release

- Deploy backend.
- Apply migrations.
- Deploy frontend.
- Deploy website if included.
- Run production smoke checklist.
- Monitor for 24-48 hours.

## Rollback Strategy

### Backend Rollback

- Redeploy previous backend build/image.
- Confirm API health.
- Validate auth/report endpoints.

### Frontend Rollback

- Redeploy previous Flutter web build.
- Confirm login and portal navigation.

### Database Rollback

If migrations are additive:

- Prefer code rollback while leaving additive columns/tables in place.

If migrations are destructive:

- Stop release.
- Require formal rollback migration and backup restore plan before deployment.

### Website Rollback

- Redeploy previous static build.

## Rollback Triggers

Immediate rollback decision if:

- Provider login fails for seeded/known providers.
- Admin/super admin login fails.
- Tenant isolation fails.
- Report creation fails.
- Assignment/completion fails.
- Evidence upload fails.
- API 5xx spikes.
- Database migration fails.

Investigate before rollback if:

- Website content issue.
- Non-blocking UI layout issue.
- Future module metadata display issue.
- Minor analytics placeholder issue.

## Monitoring Window

Minimum 24 hours after release, preferably 48 hours.

Monitor:

- API health.
- Error rate.
- Login failures.
- Upload failures.
- Notification failures.
- Database health.
- Disk usage.
- Frontend console errors.
- User-reported issues.

