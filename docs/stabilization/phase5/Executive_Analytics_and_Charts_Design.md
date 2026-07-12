# Executive Analytics and Charts Design

Date: 2026-07-12

## 1. Current Verified State

Backend has authenticated endpoints for:

- dashboard summary;
- report trends;
- category trends;
- provider performance;
- advanced analytics.

These are useful foundations but not yet a complete executive analytics platform. Flutter has analytics/dashboard screens and provider analytics UI, but no approved charting dependency was found in `pubspec.yaml`.

## 2. Required Chart Contracts

Add stable backend chart contracts for:

- report volume over time;
- resolution trend;
- status distribution;
- category distribution;
- average resolution time trend;
- assignment response and timeout trend;
- provider performance;
- organization adoption;
- authorized commercial indicators;
- geographic summary.

## 3. Contract Requirements

Every chart response should include:

- metric definition;
- date range;
- granularity;
- tenant scope;
- generatedAt;
- series labels;
- export-ready table rows;
- empty-state marker.

No chart should include PII.

## 4. Flutter Requirements

- loading state;
- empty state;
- error state;
- date-range filter;
- accessible labels;
- responsive layout at 320px;
- no fabricated percentages.

## 5. Tests Required

- tenant scoping;
- date range filtering;
- empty state;
- no PII;
- provider performance calculations;
- responsive chart layout.

