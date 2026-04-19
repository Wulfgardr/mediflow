# ADR 0002: Native security + clinical modules

Date: 2026-02-01
Status: Proposed

## Problem
The native client currently displays encrypted fields as raw ciphertext (ENC:...).
We need native unlock/decrypt and write support while preserving zero-knowledge.
In parallel, we want minimal native access to AI, drugs, and ICD‑11 modules.

## Options
1) Decrypt/encrypt on the server (client stays simple).
2) Decrypt/encrypt on the native client using the same PIN + master key.
3) Disable encrypted fields in native UI.

## Trade-offs
- (1) Simplest UX but violates the local zero‑knowledge model.
- (2) Maintains security model but requires crypto in Swift.
- (3) Fast but unacceptable UX and data loss in UI.

## Recommendation
Option 2. Implement PBKDF2 + AES-GCM in Swift, keep master key in memory only,
and decrypt fields client‑side. Add minimal write support for patient creation.
Expose AI/drugs/ICD via existing local APIs without changing core security.

## First thin slice
1) Lock screen with PIN unlock using /api/auth/login.
2) Decrypt patient notes/contacts and entry content in native UI.
3) Add native patient creation with encrypted fields.
4) Add minimal AI prompt + drugs + ICD‑11 search views.
