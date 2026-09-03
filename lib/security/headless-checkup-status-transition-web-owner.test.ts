/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';
import { CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, decodeCheckupStatusTransitionIpcFrameV1,
  encodeCheckupStatusTransitionIpcFrameV1 } from '../../packages/aip/src/checkup-status-transition-ipc.ts';

const root = process.cwd(), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-checkup-web-owner-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;
const bootstrap = new Database(databasePath);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((item) => item.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
const ACTOR = 'synthetic-physician-web-owner', PATIENT = 'synthetic-patient-web-owner';
const AMBULATORY = 'synthetic-ambulatory-web-owner', SUCCESS = 'synthetic-checkup-web-success';
const DENIED = 'synthetic-checkup-web-denied', STALE = 'synthetic-checkup-web-stale';
const EXPIRED = 'synthetic-checkup-web-expired', CUT = 'synthetic-checkup-web-cut';
const VERTICAL = 'synthetic-checkup-web-vertical';
bootstrap.prepare('INSERT INTO ambulatories (id, name, type, version) VALUES (?, ?, ?, 1)')
  .run(AMBULATORY, 'Ambulatorio sintetico', 'test');
bootstrap.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, ambulatory_id, is_archived, version)
  VALUES (?, 'Persona', 'Sintetica', 'SYNTHETICWEB01', ?, 0, 1)`).run(PATIENT, AMBULATORY);
bootstrap.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
  .run(PATIENT, AMBULATORY);
for (const [id, date] of [[SUCCESS, 1_800_000_000], [DENIED, 1_800_000_100], [STALE, 1_800_000_200],
  [EXPIRED, 1_800_000_300], [CUT, 1_800_000_400], [VERTICAL, 1_800_000_500]] as const) {
  bootstrap.prepare(`INSERT INTO checkups (id, patient_id, date, title, status, version)
    VALUES (?, ?, ?, 'Checkup sintetico', 'pending', 1)`).run(id, PATIENT, date);
}
bootstrap.close();

const { createHeadlessCheckupStatusTransitionWebOwnerV1,
  HEADLESS_CHECKUP_STATUS_REQUEST_LEDGER_LIMIT_V1 } =
  await import('./headless-checkup-status-transition-web-owner.ts');
const { createHeadlessCheckupStatusTransitionWebHttpHandlersV1 } =
  await import('./headless-checkup-status-transition-web-http.ts');
const { createIntelligentHostCheckupBrowserAdapter } =
  await import('./intelligent-host-checkup-browser-adapter.ts');
const OPERATION = 'mediflow.patient.checkup.status.transition.v1';
function closed<T extends Record<string, unknown>>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}
function fixture(checkupId: string) {
  let now = 1_802_000_000_000, active = true, role = 'physician', version = 1;
  let pinVerifier = async (pin: string): Promise<unknown> => pin === '2468'
    ? closed({ actorRef: ACTOR, sessionRef: 'session.synthetic.web' }) : null;
  const scope = () => active ? closed({ status: 'available' as const, actorRef: ACTOR, patientId: PATIENT,
    ambulatoryId: AMBULATORY, checkupId, generation: 5, revocationGeneration: 2, selectionEpoch: 9 })
    : closed({ status: 'denied' as const, code: 'session_unavailable' as const });
  const ui = () => active ? closed({ status: 'available' as const, actorRef: ACTOR, sessionRef: 'session.synthetic.web',
    role, generation: 5, revocationGeneration: 2, selectionEpoch: 9 })
    : closed({ status: 'denied' as const, code: 'session_unavailable' as const });
  const audits: unknown[] = [];
  const owner = createHeadlessCheckupStatusTransitionWebOwnerV1(closed({
    now: () => now, readHostScopeCandidate: scope, readCurrentUiContext: async () => ui(),
    verifyFreshPin: async (pin: string) => pinVerifier(pin),
    writeDenialAudit: async (record: unknown) => { audits.push(record); },
  }));
  const select = () => owner.hostUi.issueSelectedCheckupRef();
  const preview = async (targetStatus: 'completed' | 'cancelled' = 'completed', requestIndex = 0) => {
    const checkupRef = select();
    const frame = encodeCheckupStatusTransitionIpcFrameV1({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1,
      type: 'preview', requestRef: `hcqr_${requestIndex.toString(16).padStart(32, '0')}`, operationId: OPERATION,
      input: { schemaVersion: 'mediflow.patient.checkup.status.transition.input.v1', operationId: OPERATION,
        checkupRef, targetStatus, expectedRevision: version } });
    return decodeCheckupStatusTransitionIpcFrameV1(await owner.parent.handlePreview(frame));
  };
  return { owner, preview, audits, setActive: (value: boolean) => { active = value; },
    setRole: (value: string) => { role = value; }, setVersion: (value: number) => { version = value; },
    setNow: (value: number) => { now = value; },
    setPinVerifier: (value: (pin: string) => Promise<unknown>) => { pinVerifier = value; } };
}
function command(proposalRef: unknown, gesture: object, candidatePin = '2468',
  targetStatus: 'completed' | 'cancelled' = 'completed', expectedRevision = 1) {
  return closed({ schemaVersion: 'mediflow.patient.checkup.status.transition.confirmation.v1',
    operationId: OPERATION, proposalRef, targetStatus, expectedRevision, candidatePin, gesture });
}
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('retains the preview in Web and commits only through Web-local physician PIN and gesture', async () => {
  const current = fixture(SUCCESS), preview = await current.preview();
  assert.equal(preview.outcome, 'proposed');
  assert.deepEqual(await current.owner.hostUi.readCurrentProposal(preview.proposalRef), closed({
    schemaVersion: 'mediflow.patient.checkup.status.transition.proposal-view.v1',
    proposalRef: preview.proposalRef, targetStatus: 'completed', expectedRevision: 1,
    expiresAt: preview.expiresAt,
  }));
  const gesture = await current.owner.hostUi.issueExactGesture(closed({ proposalRef: preview.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 }));
  const input = command(preview.proposalRef, gesture);
  const receipt = await current.owner.hostUi.confirm(input);
  assert.equal(receipt.outcome, 'status_transitioned');
  assert.equal(current.owner.hostUi.readCommittedReceipt(closed({ proposalRef: preview.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 })), receipt, 'lookup returns the canonical receipt');
  assert.equal(await current.owner.hostUi.confirm(input), receipt, 'duplicate confirm is receipt-only');
  assert.throws(() => current.owner.hostUi.readCommittedReceipt(closed({ proposalRef: preview.proposalRef,
    targetStatus: 'cancelled', expectedRevision: 1 })),
  (error: unknown) => (error as { code?: unknown }).code === 'idempotency_conflict');
  await assert.rejects(current.owner.hostUi.confirm(command(preview.proposalRef, gesture, '2468', 'cancelled')),
    (error: unknown) => (error as { code?: unknown }).code === 'idempotency_conflict');
  await assert.rejects(current.owner.hostUi.confirm(command(preview.proposalRef, gesture, '2468', 'completed', 2)),
    (error: unknown) => (error as { code?: unknown }).code === 'idempotency_conflict');
  assert.deepEqual(Reflect.ownKeys(current.owner.parent), ['handlePreview']);
  assert.equal('confirm' in current.owner.parent, false);
  const check = new Database(databasePath, { readonly: true });
  try {
    assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id = ?').get(SUCCESS),
      { status: 'completed', version: 2 });
    assert.equal((check.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE event_type='checkup.updated' AND subject_ref=?`).get(receipt.resourceRefHash) as { count: number }).count, 1);
  } finally { check.close(); current.owner.dispose(); }
});

test('bounds the request ledger and denies N+1 without retaining another request', async () => {
  const current = fixture(DENIED);
  for (let index = 0; index < HEADLESS_CHECKUP_STATUS_REQUEST_LEDGER_LIMIT_V1; index += 1) {
    assert.equal((await current.preview('completed', index)).outcome, 'proposed');
  }
  const overflow = await current.preview('completed', HEADLESS_CHECKUP_STATUS_REQUEST_LEDGER_LIMIT_V1);
  assert.equal(overflow.outcome, 'denied'); assert.equal(overflow.denialCode, 'operation_unavailable');
  const after = await current.preview('completed', HEADLESS_CHECKUP_STATUS_REQUEST_LEDGER_LIMIT_V1 + 1);
  assert.equal(after.outcome, 'denied'); assert.equal(after.denialCode, 'operation_unavailable');
  assert.equal(current.audits.filter((value) => (value as { denialCode?: unknown }).denialCode
    === 'operation_unavailable').length, 2);
  current.owner.dispose();
});

test('expires retained proposals and revokes a confirmation while PIN verification is pending', async () => {
  const expired = fixture(EXPIRED), expiredPreview = await expired.preview();
  expired.setNow((expiredPreview.expiresAt as number) + 1);
  await assert.rejects(expired.owner.hostUi.issueExactGesture(closed({ proposalRef: expiredPreview.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 })),
  (error: unknown) => (error as { code?: unknown }).code === 'preview_expired');

  const cut = fixture(CUT), cutPreview = await cut.preview();
  const cutGesture = await cut.owner.hostUi.issueExactGesture(closed({ proposalRef: cutPreview.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 }));
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  cut.setPinVerifier(async () => { await waiting; return closed({ actorRef: ACTOR,
    sessionRef: 'session.synthetic.web' }); });
  const confirmation = cut.owner.hostUi.confirm(command(cutPreview.proposalRef, cutGesture));
  await new Promise((resolve) => setImmediate(resolve));
  cut.owner.revoke(); release();
  await assert.rejects(confirmation,
    (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');
  const check = new Database(databasePath, { readonly: true });
  try { for (const id of [EXPIRED, CUT]) assert.deepEqual(
    check.prepare('SELECT status, version FROM checkups WHERE id = ?').get(id), { status: 'pending', version: 1 }); }
  finally { check.close(); expired.owner.dispose(); cut.owner.dispose(); }
});

test('denies wrong role, session cut, stale revision and duplicate preview with zero write', async () => {
  const wrongRole = fixture(DENIED), proposal = await wrongRole.preview(); wrongRole.setRole('admin');
  await assert.rejects(wrongRole.owner.hostUi.issueExactGesture(closed({ proposalRef: proposal.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 })), (error: unknown) => (error as { code?: unknown }).code === 'role_unavailable');
  wrongRole.setRole('physician');
  const gesture = await wrongRole.owner.hostUi.issueExactGesture(closed({ proposalRef: proposal.proposalRef,
    targetStatus: 'completed', expectedRevision: 1 }));
  wrongRole.setActive(false);
  await assert.rejects(wrongRole.owner.hostUi.confirm(command(proposal.proposalRef, gesture)),
    (error: unknown) => (error as { code?: unknown }).code === 'session_unavailable');

  const stale = fixture(STALE); stale.setVersion(2); const staleResult = await stale.preview();
  assert.equal(staleResult.outcome, 'denied'); assert.equal(staleResult.denialCode, 'revision_conflict');
  const duplicate = fixture(STALE), first = await duplicate.preview(), second = await duplicate.preview();
  assert.equal(first.outcome, 'proposed'); assert.equal(second.outcome, 'denied');
  assert.equal(second.denialCode, 'proof_replayed');
  const check = new Database(databasePath, { readonly: true });
  try { for (const id of [DENIED, STALE]) assert.deepEqual(
    check.prepare('SELECT status, version FROM checkups WHERE id = ?').get(id), { status: 'pending', version: 1 }); }
  finally { check.close(); wrongRole.owner.dispose(); stale.owner.dispose(); duplicate.owner.dispose(); }
});

test('rejects a wrong operation before the Web owner and emits only redacted denial audit', async () => {
  const current = fixture(DENIED);
  const raw = JSON.stringify({ schemaVersion: CHECKUP_STATUS_TRANSITION_IPC_SCHEMA_V1, type: 'preview',
    requestRef: `hcqr_${'b'.repeat(32)}`, operationId: 'mediflow.other.v1', input: {} });
  await assert.rejects(current.owner.parent.handlePreview(raw),
    (error: unknown) => (error as { code?: unknown }).code === 'operation_unavailable');
  assert.doesNotMatch(JSON.stringify(current.audits), /synthetic-(?:patient|physician|checkup)/u);
  current.owner.dispose();
});

test('runs activation, exact-parent MCP preview, UI reread, PIN confirm, receipt replay, and revoke', async () => {
  const current = fixture(VERTICAL), uiBindingRef = `hcub_${'9'.repeat(64)}`;
  const handlers = createHeadlessCheckupStatusTransitionWebHttpHandlersV1({
    readAuthenticated: async () => true,
    select: async () => {
      const checkupRef = current.owner.hostUi.issueSelectedCheckupRef();
      const projection = current.owner.hostUi.readSelectedCheckupUiProjection(checkupRef);
      return closed({ checkupRef, uiBindingRef, resourceTitle: projection.title,
        resourceRevision: projection.expectedRevision });
    },
    read: async (value: unknown) => {
      const input = value as { proposalRef: string; uiBindingRef: string };
      assert.equal(input.uiBindingRef, uiBindingRef);
      const proposal = await current.owner.hostUi.readCurrentProposal(input.proposalRef);
      const projection = current.owner.hostUi.readSelectedCheckupUiProjection(
        current.owner.hostUi.issueSelectedCheckupRef());
      return closed({ ...proposal, resourceTitle: projection.title,
        resourceRevision: projection.expectedRevision });
    },
    confirm: async (value: unknown) => {
      const input = value as { proposalRef: string; targetStatus: 'completed' | 'cancelled';
        expectedRevision: number; candidatePin: string; uiBindingRef: string };
      assert.equal(input.uiBindingRef, uiBindingRef);
      const binding = closed({ proposalRef: input.proposalRef, targetStatus: input.targetStatus,
        expectedRevision: input.expectedRevision });
      const replay = current.owner.hostUi.readCommittedReceipt(binding); if (replay) return replay;
      const gesture = await current.owner.hostUi.issueExactGesture(binding);
      return current.owner.hostUi.confirm(command(input.proposalRef, gesture, input.candidatePin,
        input.targetStatus, input.expectedRevision));
    },
    revoke: async () => current.owner.dispose(),
  });
  const lease = { sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 1_900_000_000_000 };
  const calls: string[] = [];
  const browser = createIntelligentHostCheckupBrowserAdapter({ fetch: async (input, init = {}) => {
    const url = String(input); calls.push(`${init.method}:${url}`);
    if (url === '/api/ai/smart-import/selection') return new Response(JSON.stringify(init.method === 'GET'
      ? { selectionEpoch: 0 } : { selection: lease }));
    if (url.endsWith('/intelligent-host/activate')) {
      return new Response(JSON.stringify({ state: 'active', expiresAt: 1_900_000_000_000 }));
    }
    const request = new Request(`http://127.0.0.1${url}`, init);
    const route = Object.freeze({ params: Promise.resolve(Object.freeze({ id: PATIENT })) });
    const proposalRef = url.split('/proposals/')[1];
    const proposalRoute = Object.freeze({ params: Promise.resolve(Object.freeze({ id: PATIENT, proposalRef })) });
    if (proposalRef && init.method === 'GET') return handlers.read(request, proposalRoute);
    if (proposalRef && init.method === 'POST') return handlers.confirm(request, proposalRoute);
    if (init.method === 'DELETE') return handlers.revoke(request, route);
    return handlers.select(request, route);
  } });

  const selection = await browser.select(PATIENT, AMBULATORY, VERTICAL);
  const preview = await current.preview('completed', 31);
  assert.equal(preview.outcome, 'proposed'); assert.deepEqual(Reflect.ownKeys(current.owner.parent), ['handlePreview']);
  const proposal = await browser.read(PATIENT, preview.proposalRef);
  assert.deepEqual({ title: proposal.resourceTitle, revision: proposal.resourceRevision },
    { title: 'Checkup sintetico', revision: 1 });
  const receipt = await browser.confirm(PATIENT, proposal, '2468');
  assert.deepEqual(await browser.confirm(PATIENT, proposal, '2468'), receipt);
  assert.equal(await browser.revokeOperation(PATIENT), 'revoked');
  assert.deepEqual(calls.slice(0, 4), ['GET:/api/ai/smart-import/selection',
    'POST:/api/ai/smart-import/selection', `POST:/api/patients/${PATIENT}/intelligent-host/activate`,
    `POST:/api/patients/${PATIENT}/intelligent-host/checkup-status`]);
  const check = new Database(databasePath, { readonly: true });
  try {
    assert.deepEqual(check.prepare('SELECT status, version FROM checkups WHERE id=?').get(VERTICAL),
      { status: 'completed', version: 2 });
    assert.equal((check.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type='checkup.updated'
      AND redacted_metadata LIKE ?`).get(`%${receipt.receiptRefHash}%`) as { count: number }).count, 1);
  } finally { check.close(); }
  assert.equal(selection.resourceRevision, 1);
});
