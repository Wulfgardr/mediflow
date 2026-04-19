# ADR 0005: Web/native functional parity on a shared local contract

Date: 2026-02-06
Status: Accepted

## Problem
The web app and native app currently expose different capabilities and partially
different API surfaces. Product direction requires full functional parity:
view/add/edit/delete/filter with no feature gap, while both clients remain
different UIs over the same local data model.

## Options
1) Keep separate feature paths per client and close gaps ad hoc.
2) Let native clients read/write SQLite directly.
3) Enforce parity through a single versioned local API contract (`/api/v1/*`)
   backed by the same SQLite schema and encryption model.

## Trade-offs
- (1) ships faster short-term but accumulates drift and inconsistent behavior.
- (2) removes API work but duplicates business/security logic and increases risk.
- (3) requires disciplined API evolution, but preserves one source of truth and
  enables predictable parity across web and native.

## Decision
Adopt option (3): parity is delivered through stable versioned local APIs,
shared schema/migrations, and shared encryption semantics. Web and native remain
two expressions of the same local backend contract.

## First thin slice
1) Promote shared catalogs to `/api/v1` (drugs, exemptions) with search/filter.
2) Keep catalogs on shared SQLite tables (no native-only storage).
3) Track parity work as explicit plan items (CRUD + filters by module).
4) Extend `/api/v1` write/update/delete coverage module-by-module until parity.
