# Protected Baselines

Date: 2026-07-09

## Purpose

This document defines the protected production and milestone baselines that must not be overwritten, discarded, force-pushed away or merged casually.

## Baseline A: Current Production Deployment

Status: Protected, exact live commit hashes pending verification.

Must capture:

- Backend live commit.
- Flutter web live commit.
- Website live commit.
- Database migration level.
- Deployment timestamp.
- Dokploy service version/build reference.
- Environment profile.

Production behavior to protect:

- Authentication.
- RBAC.
- Organizations.
- Multi-tenancy.
- Audit logging.
- Evidence uploads.
- Notification delivery.
- Assignment lifecycle.
- Completion lifecycle.
- Production API contracts.
- Existing database schema.
- Existing production endpoints.
- Existing production behavior.

## Baseline B: Post-Production Milestone Branches

Status: Protected, valuable milestone work.

Backend:

- Repository: `fixzone_enterprise_api`
- Branch: `phase-4-platform-expansion`
- Current local HEAD during audit: `7151cfe`
- Important remote milestone: `origin/phase-4-platform-expansion` at `255f9e9`

Frontend:

- Repository: `fixzone`
- Branch: `phase-4-platform-expansion`
- Current local HEAD during audit: `fddb16c`
- Important remote milestone: `origin/phase-4-platform-expansion` at `c58bec6`

Documentation:

- Repository: `securezone-platform`
- Branch: `main`
- Current remote HEAD: `3b61871`
- Local uncommitted Phase 5E docs work exists and must be preserved.

Website:

- Repository: `securezone-digital-experience-platform`
- Branch: `main`
- Current HEAD: `a1c775a`

## Items That Must Never Be Overwritten

- Provider authentication stabilization.
- Mobile responsiveness fixes.
- Platform module registry.
- Module-aware navigation/access framework.
- Enterprise service framework metadata.
- Platform configuration/readiness governance.
- Trust/access/subscription profile.
- Workflow orchestration engine.
- Documentation ADRs and phase history.

## Required Tags

Recommended tags:

- `baseline-a-production-YYYYMMDD`
- `baseline-b-backend-phase5e-YYYYMMDD`
- `baseline-b-frontend-phase5e-YYYYMMDD`
- `baseline-b-docs-phase5e-YYYYMMDD`

## Baseline Verification Checklist

- [ ] Production backend commit captured.
- [ ] Production frontend commit captured.
- [ ] Production website commit captured.
- [ ] Production database migration level captured.
- [ ] Backend milestone branch pushed.
- [ ] Frontend milestone branch pushed.
- [ ] Docs Phase 5E work committed.
- [ ] All baselines tagged.
- [ ] Release matrix created.

