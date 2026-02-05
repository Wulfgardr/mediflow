<!-- Codex: created 2026-02-01 -->
# ADR 0001: Native macOS client prototype

Date: 2026-02-01
Status: Proposed

## Problem
We need a native macOS client from day zero while preserving local-first architecture,
security, and existing local services (SQLite, Ollama, ICD).

## Options
1) SwiftUI client using a local API (/api/v1) provided by existing local services.
2) SwiftUI app with direct SQLite access.
3) WebView wrapper around the existing web UI.

## Trade-offs
- Option 1: Native UI + shared backend logic; requires a local API, auth, and TLS.
- Option 2: No local server dependency; duplicates crypto and data logic, higher risk.
- Option 3: Fast but not truly native; conflicts with the nativita-first goal.

## Recommendation
Option 1. Build a SwiftUI macOS client that talks to a loopback-only, versioned local
API that remains the single source of business logic.

## First thin slice
1) Define DTOs: PatientSummary, PatientDetail.
2) Implement read-only endpoints: /api/v1/patients and /api/v1/patients/:id.
3) Bind the API to loopback only and require a token stored in Keychain.
4) Add TLS for local transport.
5) Build a macOS SwiftUI app in native/ with a patient list + detail view.
