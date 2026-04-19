# ADR 0003: Native write operations + clinical tools

Date: 2026-02-01
Status: Proposed

## Problem
The native client must add clinical data (entries/therapies/checkups) while staying
compatible with the existing web app. It also needs AI, drugs, and ICD tools
without breaking the local-first security model.

## Options
1) Add new native-only storage tables.
2) Write through existing local API endpoints with encrypted payloads.
3) Defer write operations until a full sync layer exists.

## Trade-offs
- (1) Diverges data models and risks drift.
- (2) Preserves compatibility and zero-knowledge, minimal server changes.
- (3) Safe but blocks the native workflow.

## Recommendation
Option 2. Use versioned local API endpoints for write operations and keep the
crypto on the native client, mirroring the web behavior.

## First thin slice
1) Add POST endpoints for entries/therapies/checkups in /api/v1.
2) Add native forms for creating entries, therapies, and appointments.
3) Add minimal AI/drugs/ICD tools usable from the native client.
