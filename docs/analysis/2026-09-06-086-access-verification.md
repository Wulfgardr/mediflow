# MediFlow 0.8.6 — WUL-675 access verification

- Date: 2026-09-06
- Branch: `codex/WUL-683-086-deslop`
- Baseline: `d7dbfcafb5fdf4d24396dc702803934002039ab5`
- Scope: access, application lock, logout, account recovery, and PIN lockout
  verification with synthetic fixtures only.

## Scope and claim ceiling

This packet owns one auth E2E spec and this report. It does not change runtime
code, auth contracts, database schema, configuration, or the global Markdown
index. The E2E run used a fresh SQLite database created from repository
migrations under `/tmp/mediflow-wul675-access-verification-3273/`,
`MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1`, loopback `127.0.0.1:3273`, and the
synthetic `admin`/`1234` fixture. No real database, credential, PHI/PII,
network service, push, PR, or tracker was used.

The evidence supports the tested local candidate on one Node 24 process and one
browser request context. It does not establish native parity, multi-tab or
multiprocess behavior, restart recovery, remote CI, release readiness, or
security beyond the exercised contracts.

## Contracts and source surfaces read

- `docs/roadmap-086-consolidamento.md:281` identifies WUL-675 as “Accesso,
  PIN, blocco e logout verificabili”.
- `docs/adr/0017-auth-lockout-policy.md:43-77` fixes five failures, 15-minute
  window and lock, `401`/`423`, `Retry-After`, and server-owned messaging.
- `docs/adr/0104-web-lock-revocation-fence-and-credential-transport.md:41-90`
  requires the control fence, exact bearer/control binding, commit-last lock,
  and fail-closed late auth behavior.
- `docs/adr/0106-web-auth-logout-pin-setup-lifecycle.md:43-63,89-126`
  requires exact-session logout with `204`/`no-store` and no cookie mutation,
  terminal PIN retirement, commit-last setup, and ordinary-login recovery after
  a setup auth denial. Its reset-PIN packet remains separate.
- Runtime route contracts were inspected at
  `app/api/auth/login/route.ts:36-112`, `app/api/auth/lock/route.ts:9-19`,
  `app/api/auth/logout/route.ts:10-21`, `app/api/auth/reset/route.ts:39-85`,
  and `app/api/auth/setup/route.ts:35-126`.

## Verification matrix

| Surface | Synthetic evidence | Result |
| --- | --- | --- |
| Access/login | Existing `e2e/web-auth-login-p3.spec.ts:8-37`; new lifecycle spec `:18-34` checks `/api/auth/check`, login ETag/session, and authenticated `/api/patients`. | PASS, 1/1 E2E |
| Application lock | New lifecycle spec `:36-52` posts the exact ETag/idempotency mutation, requires the confirmed receipt, then requires the protected route to return `401`. Unit falsifiers cover pending login, replay, stale cookies, hostile values, receipt shape, cleanup, and audit failure in `lib/security/web-auth-application-lock-server.test.ts:61-242`. | PASS |
| Ordinary-login recovery after lock | New lifecycle spec `:48-59` confirms `hasSession:false`, then logs in again with the successor fence. | PASS |
| Logout | New lifecycle spec `:61-66` requires `204`, empty body, and denial from the protected route afterward. Unit tests require exact bearer/control retirement before audit and no `Set-Cookie` at `lib/security/web-auth-logout-server.test.ts:75-107`; hostile/missing bindings are denied at `:109-174`. | PASS |
| Account recovery after administrative reset | New lifecycle spec `:68-105` logs in, posts the reset against the synthetic DB, requires protected-route denial, observes `isSetup:false`, runs setup with synthetic key material, and requires protected-route access again. Static route ordering/abort checks remain in `lib/security/auth-reset-lifecycle.test.ts:8-29`; owner process reset checks passed. | PASS |
| PIN lockout | `lib/security/auth-lockout.test.ts:18-153` covers window, threshold, expiry, payload and retry timing. `lib/security/host-credential-verification.test.ts:296-310` proves active lock denies before compare and valid PIN resets persisted counters using an isolated synthetic SQLite database. | PASS |
| PIN rotation boundary | `lib/security/pin-change-service.test.ts:204-507` covers successful re-wrap, same-user session retirement, CAS race, prepare failure, terminal confirmation, and lock winning after CAS. | PASS |

## Added test

Added one focused spec: `e2e/web-auth-access-lifecycle.spec.ts:14-106`.
It is deliberately one sequential scenario on a fresh synthetic database so
lock, logout, relogin, administrative reset, setup, and protected access are
observed across the same local process without introducing a second runtime
contract or a real data dependency.

## Commands and results

All commands below used Node `v24.19.0` from
`/Users/leonardopegollo/.nvm/versions/node/v24.19.0/bin`.

1. Focused auth matrix:

   ```text
   node scripts/run-strip-types.mjs --test --test-concurrency=1 \
     lib/security/auth-lockout.test.ts \
     lib/security/host-credential-verification.test.ts \
     lib/security/server-auth.test.ts \
     lib/security/web-auth-session-issuer.test.ts \
     lib/security/web-auth-control-record.test.ts \
     lib/security/web-auth-application-lock-server.test.ts \
     lib/security/web-auth-logout-server.test.ts \
     lib/security/auth-reset-lifecycle.test.ts \
     lib/security/web-auth-lifecycle-owner-process.test.ts \
     lib/security/pin-change.test.ts \
     lib/security/pin-change-service.test.ts \
     lib/security/client-application-lock.test.ts \
     lib/security/web-auth-setup-route.test.ts
   ```

   Result: **119 passed, 0 failed**.

2. Owner/boundary checks:

   ```text
   node scripts/run-strip-types.mjs --test --test-concurrency=1 \
     lib/security/server-auth-policy.test.ts \
     lib/security/web-auth-lifecycle-owner-boundary.test.ts \
     lib/security/web-auth-next-producer-boundary.test.ts \
     lib/security/web-auth-lifecycle-owner-resolver-boundary.test.ts
   ```

   Result: **14 passed, 0 failed**.

3. Existing login E2E, with the same fresh-data and loopback constraints:

   ```text
   E2E_SPECS='e2e/web-auth-login-p3.spec.ts' \
   E2E_BASE_URL='http://127.0.0.1:3273' \
   MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 \
   MEDIFLOW_E2E_DATA_DIR='/tmp/mediflow-wul675-access-verification-3273/e2e-data' \
   E2E_NEXT_BUNDLER=webpack bash scripts/e2e-smoke.sh
   ```

   Result: **1 passed, 0 failed**.

4. Added access/lock/logout/recovery E2E:

   ```text
   E2E_SPECS='e2e/web-auth-access-lifecycle.spec.ts' \
   E2E_BASE_URL='http://127.0.0.1:3273' \
   MEDIFLOW_E2E_DISABLE_LEGACY_COPY=1 \
   MEDIFLOW_E2E_DATA_DIR='/tmp/mediflow-wul675-access-verification-3273/lifecycle-data' \
   E2E_NEXT_BUNDLER=webpack bash scripts/e2e-smoke.sh
   ```

   Result: **1 passed, 0 failed**. The server created by the smoke harness was
   stopped by its own cleanup trap. Port 3272 was already occupied by another
   process and was left untouched; port 3273 was used only for this evidence.

5. `git diff --check`: **pass**.

## Findings and limits

No reproducible auth bug was observed in this bounded matrix, so there is no
bug patch to route to the parent. The strongest evidence is terminal behavior:
after application lock and logout the same protected request returned `401`,
while a new login restored access; after synthetic administrative reset, setup
restored a session and protected access on the same local process.

The account-lockout result is verifier-level synthetic SQLite evidence, not a
browser sequence of five wrong-PIN requests. The E2E scenario uses request APIs
inside Playwright rather than visual clicks, and does not test native login,
multi-tab races, process restart, crash recovery, or cross-process ownership.
Administrative reset here is the existing synthetic reset route; it does not
claim that a user-facing forgotten-PIN flow exists. No speculative lint quota
or broad auth audit is claimed.

Parent handoff: review the one added auth spec and this report, then decide
whether to retain the E2E tranche. The global Markdown index remains untouched
for the parent lane.
