# Operational Responsibility Registry Design

Date: 2026-07-12

## 1. Current Verified State

No production backend model or controller for operational areas, facilities, assets, service locations, projects, or responsibility rules was found.

Website copy references an “Operational Locations Registry” as a future-ready scenario. That is currently classified as placeholder-only until backend persistence, APIs, UI, and tests exist.

## 2. Purpose

The Operational Responsibility Registry should let organizations define service responsibility records that can later support:

- report enrichment;
- jurisdiction routing;
- duplicate detection;
- GIS layers;
- operational ownership audit;
- public aggregated transparency.

## 3. Proposed Registry Record

Fields:

- `id`
- `organizationId`
- `name`
- `type`
- `description`
- `status`
- `latitude`
- `longitude`
- `address`
- `state`
- `lga`
- `ward`
- `responsibleUnit`
- `contactRole`
- `serviceCategories`
- `createdAt`
- `updatedAt`

Avoid personal public contact details. Use role/team labels rather than private phone numbers or personal emails.

## 4. Report Linkage

Reports should optionally link to:

- operational area;
- facility;
- project;
- asset;
- service location.

This link must remain optional for ordinary citizen reporting.

Organization users should be able to enrich or correct linkage after accepting responsibility for a report.

## 5. Audit Requirements

Audit events:

- registry item created;
- registry item updated;
- registry item archived;
- report linked to registry item;
- report registry link changed;
- manual responsibility override.

## 6. Tests Required

- tenant isolation;
- CRUD permissions;
- report link/unlink;
- audit event creation;
- category/service-scope matching;
- archived registry records excluded from active routing unless explicitly requested.

