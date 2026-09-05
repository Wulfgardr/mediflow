/* @Codex */
import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';

import { dbServer, hasCanonicalHeadlessCheckupActiveRoleAttestationSchema,
  runDbServerImmediateTransaction } from '../db-server';

const SCHEMA = 'mediflow.headless-checkup-active-role-attestation.v1' as const;
const OPERATION = 'mediflow.patient.checkup.status.transition.v1' as const;
const POLICY = 'physician_confirmed_single_use.v1' as const;
export const HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATION_TTL_SECONDS = 8 * 60 * 60;
const TTL_SECONDS = HEADLESS_CHECKUP_ACTIVE_ROLE_ATTESTATION_TTL_SECONDS;
const REF = /^hcar_[0-9a-f]{32}$/u, ISSUER = /^hcari_[0-9a-f]{32}$/u;
const EVENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Lifecycle = { status: 'inactive' | 'active' | 'revoked'; issuerRef: string | null;
  expiresAt: Date | null; activatedAt: Date | null; revocationGeneration: number; revokedAt: Date | null };
export type HeadlessCheckupActiveRoleAttestationV1 = Readonly<Lifecycle & {
  attestationRef: string; actorRef: string; schemaVersion: typeof SCHEMA; role: 'physician';
  operationId: typeof OPERATION; policyVersion: typeof POLICY; attestationVersion: 1;
  createdAt: Date; updatedAt: Date;
}>;
export class HeadlessCheckupActiveRoleAttestationError extends Error {
  constructor(readonly code: 'actor_invalid' | 'actor_missing' | 'attestation_conflict' | 'attestation_missing'
    | 'schema_incompatible' | 'storage_unavailable' | 'stored_state_invalid') {
    super(`Headless checkup active-role attestation rejected: ${code}`);
    this.name = 'HeadlessCheckupActiveRoleAttestationError';
  }
}
type Sources = Readonly<{ now?: () => number; entropy?: (size: number) => Uint8Array; eventRef?: () => string }>;
export type HeadlessCheckupActiveRoleAttestationExpectedV1 = Readonly<{
  attestationRef: string; attestationVersion: 1; revocationGeneration: 0;
}>;
type Row = Record<string, unknown>;
const SELECT = `SELECT attestation_ref AS attestationRef, actor_ref AS actorRef, schema_version AS schemaVersion,
 role, operation_id AS operationId, policy_version AS policyVersion, status, attestation_version AS attestationVersion,
 issuer_ref AS issuerRef, expires_at AS expiresAt, activated_at AS activatedAt,
 revocation_generation AS revocationGeneration, revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
 FROM headless_checkup_active_role_attestations WHERE actor_ref = ? LIMIT 2`;
const SELECT_REF = 'SELECT attestation_ref AS attestationRef FROM headless_checkup_active_role_attestations WHERE attestation_ref = ? LIMIT 2';

function fail(code: ConstructorParameters<typeof HeadlessCheckupActiveRoleAttestationError>[0]): never {
  throw new HeadlessCheckupActiveRoleAttestationError(code);
}
function actor(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function expected(value: unknown): value is HeadlessCheckupActiveRoleAttestationExpectedV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Row, keys = Reflect.ownKeys(value);
  return keys.length === 3 && keys.includes('attestationRef') && keys.includes('attestationVersion')
    && keys.includes('revocationGeneration') && typeof item.attestationRef === 'string'
    && REF.test(item.attestationRef) && item.attestationVersion === 1 && item.revocationGeneration === 0;
}
function date(seconds: number): Date { return new Date(seconds * 1_000); }
function ref(prefix: 'hcar_' | 'hcari_', entropy: (size: number) => Uint8Array): string {
  const value = entropy(16);
  if (!(value instanceof Uint8Array) || value.byteLength !== 16) return fail('storage_unavailable');
  return `${prefix}${Buffer.from(value).toString('hex')}`;
}
function row(value: unknown): HeadlessCheckupActiveRoleAttestationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('stored_state_invalid');
  const item = value as Row;
  if (!actor(item.actorRef) || typeof item.attestationRef !== 'string' || !REF.test(item.attestationRef)
    || item.schemaVersion !== SCHEMA || item.role !== 'physician' || item.operationId !== OPERATION
    || item.policyVersion !== POLICY || item.attestationVersion !== 1 || !integer(item.revocationGeneration)
    || !integer(item.createdAt) || !integer(item.updatedAt, item.createdAt as number)) return fail('stored_state_invalid');
  const inactive = item.status === 'inactive' && item.issuerRef === null && item.expiresAt === null
    && item.activatedAt === null && item.revokedAt === null && item.revocationGeneration === 0;
  const activation = typeof item.issuerRef === 'string' && ISSUER.test(item.issuerRef)
    && integer(item.activatedAt, item.createdAt as number) && integer(item.expiresAt, item.activatedAt as number)
    && (item.expiresAt as number) - (item.activatedAt as number) === TTL_SECONDS;
  const active = item.status === 'active' && activation && item.revokedAt === null && item.revocationGeneration === 0;
  const revoked = item.status === 'revoked' && integer(item.revokedAt, item.createdAt as number)
    && (item.revocationGeneration as number) >= 1 && (activation || (item.issuerRef === null
      && item.expiresAt === null && item.activatedAt === null));
  if (!inactive && !active && !revoked) return fail('stored_state_invalid');
  return Object.freeze(Object.assign(Object.create(null), {
    attestationRef: item.attestationRef, actorRef: item.actorRef, schemaVersion: SCHEMA, role: 'physician' as const,
    operationId: OPERATION, policyVersion: POLICY, status: item.status as Lifecycle['status'], attestationVersion: 1 as const,
    issuerRef: item.issuerRef as string | null, expiresAt: item.expiresAt === null ? null : date(item.expiresAt as number),
    activatedAt: item.activatedAt === null ? null : date(item.activatedAt as number),
    revocationGeneration: item.revocationGeneration as number,
    revokedAt: item.revokedAt === null ? null : date(item.revokedAt as number),
    createdAt: date(item.createdAt as number), updatedAt: date(item.updatedAt as number),
  })) as HeadlessCheckupActiveRoleAttestationV1;
}

/** Fixed-operation lifecycle store; activation/revocation and their audits commit atomically. */
export function createHeadlessCheckupActiveRoleAttestationStoreV1(sources: Sources = {}) {
  const now = sources.now ?? Date.now, entropy = sources.entropy ?? randomBytes;
  const eventRef = sources.eventRef ?? randomUUID, db = dbServer.$client;
  const timestamp = (): number => { const value = now(), seconds = Math.floor(value / 1_000);
    return integer(value) && integer(seconds) && seconds <= 8_640_000_000_000
      ? seconds : fail('storage_unavailable'); };
  const nextEventRef = (): string => { const value = eventRef();
    return typeof value === 'string' && EVENT.test(value) ? value : fail('storage_unavailable'); };
  const canonicalActor = (actorRef: string): void => {
    const matches = db.prepare('SELECT id FROM users WHERE id = ? LIMIT 2').all(actorRef) as Row[];
    if (matches.length === 0) return fail('actor_missing');
    if (matches.length !== 1 || matches[0]?.id !== actorRef) return fail('stored_state_invalid');
  };
  const readExact = (actorRef: string): HeadlessCheckupActiveRoleAttestationV1 => {
    const rows = db.prepare(SELECT).all(actorRef) as Row[];
    if (rows.length === 0) return fail('attestation_missing');
    if (rows.length !== 1) return fail('stored_state_invalid');
    return row(rows[0]);
  };
  const transaction = <T>(action: () => T): T => {
    try { return runDbServerImmediateTransaction(() => {
      if (!hasCanonicalHeadlessCheckupActiveRoleAttestationSchema()) return fail('schema_incompatible');
      return action();
    }); } catch (error) {
      if (error instanceof HeadlessCheckupActiveRoleAttestationError) throw error;
      return fail('storage_unavailable');
    }
  };
  return Object.freeze({
    read(actorRef: unknown) {
      if (!actor(actorRef)) return fail('actor_invalid');
      return transaction(() => { canonicalActor(actorRef); return readExact(actorRef); });
    },
    createInactive(actorRef: unknown) {
      if (!actor(actorRef)) return fail('actor_invalid');
      return transaction(() => {
        canonicalActor(actorRef);
        const existing = db.prepare(SELECT).all(actorRef) as Row[];
        if (existing.length > 0) { if (existing.length !== 1) return fail('stored_state_invalid');
          row(existing[0]); return fail('attestation_conflict'); }
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = timestamp(), attestationRef = ref('hcar_', entropy);
          const collisions = db.prepare(SELECT_REF).all(attestationRef) as Row[];
          if (collisions.length > 0) { if (collisions.length !== 1
            || collisions[0]?.attestationRef !== attestationRef) return fail('stored_state_invalid'); continue; }
          const result = db.prepare(`INSERT INTO headless_checkup_active_role_attestations
            (attestation_ref,actor_ref,schema_version,role,operation_id,policy_version,status,attestation_version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'inactive',1,?,?)`).run(attestationRef, actorRef, SCHEMA, 'physician', OPERATION,
              POLICY, current, current);
          if (result.changes !== 1) return fail('storage_unavailable');
          return readExact(actorRef);
        }
        return fail('attestation_conflict');
      });
    },
    activate(actorRef: unknown) {
      if (!actor(actorRef)) return fail('actor_invalid');
      return transaction(() => {
        canonicalActor(actorRef); const before = readExact(actorRef), current = timestamp();
        if (before.status === 'revoked' || (before.status === 'active'
          && (before.expiresAt?.getTime() ?? 0) > current * 1_000)) return fail('attestation_conflict');
        const issuerRef = ref('hcari_', entropy), expires = current + TTL_SECONDS;
        const result = db.prepare(`UPDATE headless_checkup_active_role_attestations SET status='active', issuer_ref=?,
          expires_at=?, activated_at=?, updated_at=? WHERE actor_ref=? AND attestation_ref=? AND status IN ('inactive','active')
          AND revocation_generation=0 AND revoked_at IS NULL`).run(issuerRef, expires, current, current,
            actorRef, before.attestationRef);
        if (result.changes !== 1) return fail('attestation_conflict');
        const audit = db.prepare(`INSERT INTO audit_events (event_id,schema_version,event_type,occurred_at,outcome,
          actor_type,actor_ref,subject_type,subject_ref,source_surface,request_id,redacted_metadata,created_at)
          VALUES (?,1,'auth.checkup_active_role.enrolled',?,'success','user',?,'active_role_attestation',?,'web',NULL,
          '{"flags":["auth:session"],"reasonCode":"controlled_setup"}',?)`)
          .run(nextEventRef(), current, actorRef, before.attestationRef, current);
        if (audit.changes !== 1) return fail('storage_unavailable');
        return readExact(actorRef);
      });
    },
    revoke(actorRef: unknown, currentExpected: unknown) {
      if (!actor(actorRef) || !expected(currentExpected)) return fail('actor_invalid');
      return transaction(() => {
        canonicalActor(actorRef); const before = readExact(actorRef);
        if (before.status === 'revoked' || before.attestationRef !== currentExpected.attestationRef
          || before.attestationVersion !== currentExpected.attestationVersion
          || before.revocationGeneration !== currentExpected.revocationGeneration) return fail('attestation_conflict');
        const current = timestamp(), result = db.prepare(`UPDATE headless_checkup_active_role_attestations
          SET status='revoked',revocation_generation=revocation_generation+1,revoked_at=?,updated_at=?
          WHERE actor_ref=? AND attestation_ref=? AND status IN ('inactive','active') AND revocation_generation=0
          AND revoked_at IS NULL`).run(current, current, actorRef, before.attestationRef);
        if (result.changes !== 1) return fail('attestation_conflict');
        const audit = db.prepare(`INSERT INTO audit_events (event_id,schema_version,event_type,occurred_at,outcome,
          actor_type,actor_ref,subject_type,subject_ref,source_surface,request_id,redacted_metadata,created_at)
          VALUES (?,1,'auth.checkup_active_role.revoked',?,'success','user',?,'active_role_attestation',?,'web',NULL,
          '{"flags":["auth:session"],"reasonCode":"explicit_revoke"}',?)`)
          .run(nextEventRef(), current, actorRef, before.attestationRef, current);
        if (audit.changes !== 1) return fail('storage_unavailable');
        return readExact(actorRef);
      });
    },
  });
}
