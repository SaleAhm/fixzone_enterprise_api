# Public Website Live Data Production Verification

Date: 2026-07-13  
Scope: SecureZone public website live-data integration and FixZone pilot CTA

## Final Classification

PRODUCTION VERIFIED WITH CONDITIONS

The public website is displaying live production metrics from the deployed API.
The remaining source-level issue was the FixZone pilot CTA click reliability and
UTF-8 source encoding in two website files. Both were remediated locally and are
ready for controlled website redeployment after source promotion.

## Production Evidence

Production API endpoints were verified over HTTPS:

- `/api/public/metrics`
- `/api/public/trends`
- `/api/public/impact-summary`
- `/api/public/category-summary`
- `/api/public/geographic-summary`
- `/api/public/platform-status`
- `/api/public/success-stories`

Observed `/api/public/metrics` values during verification:

- Reports submitted: 94
- Active reports: 73
- Cases resolved: 40
- Closed reports: 21
- Resolution rate: 42.6%
- Average resolution time: 31.21h
- Participating organizations: 6
- Verified providers: 16
- Pilot regions: 1

These match the live values observed on the production website.

## CORS Evidence

The production API returned HTTP 200 and explicit CORS allow-origin headers for:

- `https://securezonegroup.com`
- `https://www.securezonegroup.com`

This confirms the previous `www` public metrics fallback blocker is resolved at
the API layer.

## Live Data Verification

Verified source behavior:

- Hero metrics use public API metrics.
- Partners metrics use public API metrics.
- Public impact dashboard uses public API metrics, trends, categories, and
  broad geography.
- Fallback values remain available for API failure scenarios.
- UI source labels distinguish `Live`, `Cached`, and `Fallback`.
- API URL normalization supports:
  - `VITE_PUBLIC_API_BASE_URL`
  - `VITE_PUBLIC_API_URL`
  - `VITE_API_BASE_URL`
  - `VITE_API_URL`

## FixZone CTA Remediation

The FixZone module card already used an anchor link in source, but the production
card has a decorative overlay. To make the CTA reliable across desktop, mobile,
and keyboard navigation:

- The decorative production-card overlay was changed to `pointer-events-none`.
- The content stack was lifted above the overlay.
- The CTA was lifted with explicit z-index.
- The link uses:
  - `href="https://fixzone.securezonegroup.com"`
  - `target="_blank"`
  - `rel="noopener noreferrer"`

No nested button/anchor structure was introduced.

## UTF-8 Verification

The previous Dokploy failed deployment reported:

```text
src/components/sections/Metrics.tsx
stream did not contain valid UTF-8
```

Local UTF-8 verification found invalid UTF-8 in:

- `src/components/sections/Metrics.tsx`
- `src/components/sections/PublicImpactDashboard.tsx`

Both files were normalized to UTF-8. The full website `src` tree was then
verified as UTF-8 clean.

## Privacy Safeguards

No private or tenant-sensitive data was exposed. The public website continues to
consume only aggregate public endpoints. It does not expose:

- user identities;
- phone numbers or email addresses;
- report descriptions;
- exact GPS coordinates;
- exact addresses;
- evidence URLs;
- tenant secrets.

## Validation

Website validation:

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run build` — passed

Known non-blocking warning:

- Browserslist/caniuse-lite freshness warning remains during the production
  build.

## Redeployment Instructions

After source push and fast-forward promotion:

1. Redeploy the website application in Dokploy.
2. Confirm the latest deployed website commit is the promoted `origin/main`.
3. Open `https://securezonegroup.com`.
4. Confirm the public metrics show live values.
5. Confirm the public dashboard source does not show fallback under healthy API.
6. Open the FixZone module card.
7. Click `Explore Module`.
8. Confirm it opens `https://fixzone.securezonegroup.com`.
9. Optionally repeat on `https://www.securezonegroup.com` if DNS routes there.

Backend redeployment is not required by this source change if production CORS is
already returning both apex and `www` origins.

## Remaining Limitations

- The historical failed Dokploy deployment entry may remain visible in Dokploy
  history even after a later successful deployment.
- Browser localStorage can still contain old fallback cache for users who loaded
  earlier builds, but fallback snapshots are no longer restored as cached live
  data in the remediated source.
