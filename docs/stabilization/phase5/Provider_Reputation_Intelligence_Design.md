# Provider Reputation Intelligence Design

Date: 2026-07-12

## 1. Current Verified State

The restored citizen review workflow persists `citizenRating` and `citizenFeedback` on reports. Backend provider performance currently aggregates ratings, rating count, completed jobs, and approximate response time from assigned reports.

This is a foundation, not a full provider trust/reputation intelligence system.

## 2. Proposed Metrics

- average rating;
- rating count;
- completion rate;
- rework rate;
- assignment acceptance rate;
- timeout rate;
- average response time;
- average completion time;
- verified capabilities;
- identity verification level;
- dispute rate where available.

## 3. Metric Definitions

Every metric must define:

- numerator;
- denominator;
- date range;
- tenant scope;
- minimum sample threshold;
- handling for insufficient data.

Avoid a single trust score until input weighting is documented and approved.

## 4. Badge Foundation

Future badges may include:

- Verified Identity;
- Verified Professional;
- High Completion Rate;
- Highly Rated;
- Fast Responder;
- Low Rework Rate.

Do not award badges from demo-only or fabricated values.

## 5. Tests Required

- average rating calculation;
- minimum sample threshold;
- insufficient data state;
- rework rate calculation;
- tenant isolation;
- provider self-access vs admin visibility.

