/** Host admission and the existing patient profile application service. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { normalizePatientUpdateInput } from './patient-write-normalization';
import { updatePatientOperation, type PatientUpdateOperationResult } from './patient-update-operation';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireAccountSession } from '@/lib/security/paired-native-session';
import { authenticateNetworkPairedClient } from '@/lib/network-home-base-server';
import { getNetworkModeGateResponse, resolveNetworkScope, requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { NETWORK_FSE_VALIDATE_CAPABILITY } from './network-contract';
import { PATIENT_PROFILE_READ_OPERATION, type PatientProfileActor, type PatientProfileQuery, type PatientProfileView } from './patient-profile-query';
import type { NetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { RequiredAuditContext } from './security/audit';

type PatientRecord = typeof patients.$inferSelect;
export type PatientProfileReadInput = Readonly<{ request: Request } & (
    | { projection: 'web' | 'api-v1' | 'network'; patientId: () => Promise<string | null> }
    | { projection: 'network-fse'; patientId: () => string | null }
)>;
export type PatientProfileReadResult =
    | { ok: false; response: NextResponse }
    | { ok: true; profile: Omit<PatientProfileView, 'deletedAt' | 'deletionReason'> & Partial<Pick<PatientProfileView, 'deletedAt' | 'deletionReason'>> | null; scopeAmbulatoryId: string | null };

type Admission =
    | { ok: false; response: NextResponse }
    | { ok: true; actor: PatientProfileActor; purpose: PatientProfileQuery['purpose']; scope: PatientProfileQuery['scope'] };

async function admitProfileRead(input: PatientProfileReadInput, consume: (admitted: Extract<Admission, { ok: true }>, patientId: string | null) => PatientProfileReadResult): Promise<PatientProfileReadResult> {
    const operation = PATIENT_PROFILE_READ_OPERATION;
    if (input.projection === 'api-v1') {
        const denial = requireLocalApiToken(input.request);
        if (denial) return { ok: false, response: denial };
        const patientId = await input.patientId();
        return consume({ ok: true, actor: { kind: 'local-service', ref: 'local-api', role: null, channel: 'local-token' },
            purpose: operation.purpose, scope: { kind: 'local' } }, patientId);
    }
    if (input.projection === 'web') {
        const session = await requireSession();
        if (!session) return { ok: false, response: unauthorizedResponse() };
        const patientId = await input.patientId();
        return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role, channel: 'web' },
            purpose: operation.purpose, scope: { kind: 'local' } }, patientId);
    }
    if (input.projection === 'network-fse') {
        const resolved = await requireNetworkCapabilityContext(input.request, NETWORK_FSE_VALIDATE_CAPABILITY);
        if (!resolved.ok) return resolved;
        const { session, scopeAmbulatoryId } = resolved.context;
        return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role,
            channel: session.authChannel === 'native' ? 'native' : 'web' },
        purpose: operation.fsePurpose, scope: { kind: 'ambulatory', ambulatoryId: scopeAmbulatoryId } }, input.patientId());
    }
    if (input.projection !== 'network') return { ok: false, response: unauthorizedResponse() };
    const client = await authenticateNetworkPairedClient(input.request);
    if (!client) return { ok: false, response: unauthorizedResponse() };
    const modeDenial = await getNetworkModeGateResponse();
    if (modeDenial) return { ok: false, response: modeDenial };
    if (!client.grantedCapabilities.includes('network.replica.readonly-patients')) return { ok: false, response: forbiddenResponse() };
    const session = await requireAccountSession(input.request);
    if (!session) return { ok: false, response: unauthorizedResponse() };
    const patientId = await input.patientId();
    const scopeAmbulatoryId = await resolveNetworkScope(session, input.request);
    if (!scopeAmbulatoryId) return { ok: false, response: NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 }) };
    return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role,
        channel: session.authChannel === 'native' ? 'native' : 'web' },
    purpose: operation.purpose, scope: { kind: 'ambulatory', ambulatoryId: scopeAmbulatoryId } }, patientId);
}

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function projectDetail(patient: PatientRecord): PatientProfileView {
    return {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: toIsoString(patient.birthDate),
        taxCode: patient.taxCode,
        address: patient.address ?? null,
        phone: patient.phone ?? null,
        caregiver: patient.caregiver ?? null,
        exemptions: patient.exemptions ?? null,
        diagnoses: patient.diagnoses ?? null,
        monitoringProfile: patient.monitoringProfile ?? null,
        statusReason: patient.statusReason ?? null,
        archiveReason: patient.archiveReason ?? null,
        archiveNote: patient.archiveNote ?? null,
        notes: patient.notes ?? null,
        aiSummary: patient.aiSummary ?? null,
        aiSummaryGeneratedAt: toIsoString(patient.aiSummaryGeneratedAt),
        aiSummaryContextHash: patient.aiSummaryContextHash ?? null,
        documentInsights: patient.documentInsights ?? null,
        isAdi: patient.isAdi ?? null,
        isArchived: patient.isArchived ?? null,
        deletedAt: toIsoString(patient.deletedAt), deletionReason: patient.deletionReason ?? null,
        version: patient.version,
        ambulatoryId: patient.ambulatoryId ?? null,
        createdAt: toIsoString(patient.createdAt),
        updatedAt: toIsoString(patient.updatedAt),
    };
}

function queryPatientProfile(query: PatientProfileQuery): PatientProfileView | null {
    if (query.operation !== PATIENT_PROFILE_READ_OPERATION.id) throw new Error('Unsupported patient profile query');
    const condition = and(eq(patients.id, query.patientId), activePatients());
    const patient = query.scope.kind === 'ambulatory'
        ? dbServer.select({ patient: patients }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId))).get()?.patient
        : dbServer.select().from(patients).where(condition).get();
    return patient ? projectDetail(patient) : null;
}

export async function readPatientProfile(input: PatientProfileReadInput): Promise<PatientProfileReadResult> {
    return admitProfileRead(input, (admitted, patientId) => {
        const query: PatientProfileQuery | null = patientId ? {
            operation: PATIENT_PROFILE_READ_OPERATION.id, actor: admitted.actor, purpose: admitted.purpose,
            patientId, scope: admitted.scope,
        } : null;
        const snapshot = query ? queryPatientProfile(query) : null;
        const scopeAmbulatoryId = admitted.scope.kind === 'ambulatory' ? admitted.scope.ambulatoryId : null;
        if (input.projection === 'api-v1' && snapshot) {
            const profile = { ...snapshot };
            Reflect.deleteProperty(profile, 'deletedAt');
            Reflect.deleteProperty(profile, 'deletionReason');
            return { ok: true, profile, scopeAmbulatoryId };
        }
        return { ok: true, profile: snapshot, scopeAmbulatoryId };
    });
}

export type PatientProfileUpdateContext = {
    patientId: string;
    expectedVersion: number;
    // These callbacks come from the admitted host adapter, never a decoded body.
    audit: () => RequiredAuditContext;
} & (
    | { scopeAmbulatoryId?: undefined; prepareCommitGuard?: undefined }
    | { scopeAmbulatoryId: string; prepareCommitGuard: () => Promise<NetworkPatientCommitGuard> }
);

export async function updatePatientProfile(
    context: PatientProfileUpdateContext,
    body: Record<string, unknown>,
): Promise<PatientUpdateOperationResult | { status: 400; value: { error: string } }> {
    // Web/v1 retain their existing 404-before-field-validation precedence.
    // Paired input is normalized before its final asynchronous scope admission.
    if (context.scopeAmbulatoryId === undefined) {
        const existing = await dbServer.select({ id: patients.id }).from(patients)
            .where(and(eq(patients.id, context.patientId), activePatients())).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
    }
    const normalized = normalizePatientUpdateInput(body, { expectedVersion: context.expectedVersion });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    const authorizeCommit = context.prepareCommitGuard ? await context.prepareCommitGuard() : undefined;
    // No await between resolving host audit identity and the synchronous commit.
    // The existing operation owns the one SQLite transaction, CAS and audit.
    return updatePatientOperation({
        patientId: context.patientId,
        expectedVersion: context.expectedVersion,
        values: normalized.values,
        setPrimaryAmbulatory: Object.prototype.hasOwnProperty.call(body, 'ambulatoryId'),
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        authorizeCommit,
        audit: context.audit(),
    });
}
