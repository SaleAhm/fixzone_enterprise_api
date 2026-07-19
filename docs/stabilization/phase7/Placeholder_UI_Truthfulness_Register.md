# Placeholder UI Truthfulness Register

## Summary

Phase 7B-E reviewed deferred controls and corrected the clearest misleading Flutter runtime issue: provider payment/checkout UI implied live card storage and successful payment-based upgrade despite payment gateway integration being deferred.

## Register

| Area | Current state | Classification | Phase 7B-E action |
| --- | --- | --- | --- |
| Provider payment method | Previously showed saved Visa/bank method and checkout CTA | Misleading | Fixed to manual billing readiness |
| Provider checkout route | Previously showed payment method, confirm upgrade, upgrade success and local plan mutation | Misleading | Fixed to manual review request; no automatic plan mutation |
| Provider subscription plans | Already states payment gateway pending and manual billing | Acceptable with conditions | No runtime change |
| Billing history | States real payment processor is pending and downloads are disabled | Truthful deferred | No runtime change |
| Admin monetization | Describes manual invoice RC pricing and gateway not configured | Acceptable with conditions | No runtime change |
| Backup restore/download | Backend endpoints exist; production use remains governance-controlled | Operational but controlled | No runtime change |
| Exports | Audit export endpoint exists; broader exports deferred | Partial | No runtime change |
| Email verification/recovery | Visible as pending in profile/security wording | Deferred | No runtime change |
| Duplicate-report handling | Not implemented | Deferred | No runtime change |
| Website ecosystem pages | Outside Phase 7B-E | Deferred roadmap | No runtime change |

## Truthfulness correction details

Provider payment screens now avoid:

- fake saved card numbers;
- fake bank-account identifiers;
- checkout language implying payment capture;
- success language implying immediate paid upgrade;
- local subscription mutation from a pretend checkout flow.

The route now presents manual billing review only.

## Remaining risk

A manual UI walkthrough should still inspect all role menus for hidden or route-specific placeholders not exercised by automated tests.
