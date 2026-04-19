# ADR 0004: Exemptions catalog and patient code mapping

Date: 2026-02-06
Status: Accepted

## Problem
Users need a reliable way to code patient exemptions during create/edit workflows.
The catalog is periodically updated via external TXT files and must remain local-first.

## Options
1) Store the whole catalog in a single `settings` JSON value and search client-side.
2) Introduce a dedicated local `exemptions` table with import + search APIs.
3) Keep a static in-app list and update only via app releases.

## Trade-offs
- (1) is quick but weak on scale, filtering, and cross-client reuse.
- (2) requires more code, but keeps stable contracts and supports web/native parity.
- (3) is simplest operationally but fails the requirement of file-based updates.

## Decision
Adopt option (2): dedicated `exemptions` table, import pipeline from TXT files,
search/count APIs, and encrypted patient mapping (`patients.exemptions`).

## First thin slice
1) Add schema support (`exemptions` table + `patients.exemptions` field).
2) Add local API for search/count/import/clear.
3) Add web settings manager with drag-and-drop import.
4) Add web patient form selector for exemption codes.
5) Expose patient exemptions in `/api/v1/patients/:id` for native consumption.
