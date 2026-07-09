# Production Validation Checklist

Date: 2026-07-09

## Baseline

- [ ] Production backend commit captured.
- [ ] Production frontend commit captured.
- [ ] Production website commit captured.
- [ ] Production database migration level captured.
- [ ] Production backup confirmed.
- [ ] Rollback build references captured.

## Authentication

- [ ] Citizen login works.
- [ ] Provider email/password login works.
- [ ] Provider ID login works if supported.
- [ ] Org admin login works.
- [ ] Dispatch officer login works.
- [ ] Super admin login works.
- [ ] Invalid credentials fail safely.

## Authorization and Tenancy

- [ ] Super admin sees global authorized data.
- [ ] Org admin sees only organization data.
- [ ] Dispatch sees only authorized dispatch data.
- [ ] Provider sees only assigned/authorized jobs.
- [ ] Citizen sees only own reports.
- [ ] Future modules are not operational.

## Citizen Portal

- [ ] Home loads.
- [ ] Submit report works.
- [ ] Evidence upload works.
- [ ] Report details load.
- [ ] Completion validation works.
- [ ] Notifications load.

## Provider Portal

- [ ] Dashboard loads.
- [ ] Jobs list loads.
- [ ] Job details load.
- [ ] Accept assignment works.
- [ ] Completion evidence upload works.
- [ ] Profile shows clean public provider ID.
- [ ] Subscription widget does not block workflow.

## Admin Portal

- [ ] Dashboard loads.
- [ ] Dispatch loads.
- [ ] Reports load.
- [ ] Providers loads.
- [ ] Organizations loads.
- [ ] Users loads.
- [ ] Platform Tools loads.
- [ ] Trust Center loads.

## Workflow

- [ ] Citizen report created.
- [ ] Admin/dispatch assignment works.
- [ ] Provider acceptance works.
- [ ] Provider completion works.
- [ ] Citizen validation works.
- [ ] Report closes correctly.
- [ ] Notifications emitted.
- [ ] Audit logs emitted.

## Mobile UI

- [ ] 360px width no overflow.
- [ ] 390px width no overflow.
- [ ] 430px width no overflow.
- [ ] Bottom navigation does not overlap content.
- [ ] More sheet fits.
- [ ] Provider cards fit.
- [ ] Platform Tools cards/panels fit.

## Website

- [ ] Homepage loads.
- [ ] Navigation works.
- [ ] Modules show FixZone production and future modules appropriately.
- [ ] Contact form behavior is understood.
- [ ] Footer links work.
- [ ] Mobile layout works.

## Infrastructure

- [ ] API health check passes.
- [ ] Database connectivity confirmed.
- [ ] SSL valid.
- [ ] Disk usage safe.
- [ ] Monitoring active.
- [ ] Logs accessible.
- [ ] Backup still running.

## Acceptance

- [ ] No P0 defects.
- [ ] No tenant isolation defects.
- [ ] No auth defects.
- [ ] No workflow-blocking defects.
- [ ] Release notes updated.
- [ ] Monitoring window started.

