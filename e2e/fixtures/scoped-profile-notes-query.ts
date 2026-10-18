import { randomBytes } from 'node:crypto';
import { parseProfileQuery, assertProfileResultBudget, type ProfileQuery, type ProfileResult } from '../../lib/patient-profile-scoped-contract';

type OpenNotes = Extract<ProfileQuery, { kind: 'open' }>;
type ObservedRequest = Readonly<{ method(): string; url(): string; postDataJSON(): unknown }>;

/** Classifies only the notes view's read request; it does not establish host authorization. */
export function scopedNotesOpenInput(request: ObservedRequest, patientId: string, expectedOrigin: string): OpenNotes | null {
    try {
        const url = new URL(request.url());
        if (request.method() !== 'POST' || url.origin !== expectedOrigin || url.search || url.hash
            || url.pathname !== `/api/patients/${encodeURIComponent(patientId)}/profile-query`) return null;
        const input = parseProfileQuery(request.postDataJSON());
        return input?.kind === 'open' && input.projection === 'notes' ? input : null;
    } catch { return null; }
}

/** Synthetic display data for fixture patients absent from the host database, never an admission proof. */
export function syntheticScopedNotesView(input: OpenNotes, patient: Readonly<{ version: number; notes?: string | null }>): ProfileResult {
    const observedAt = Date.now();
    const result: ProfileResult = { schemaVersion: 'mediflow.patient.profile-view.v1', operationId: 'patient-profile.read.v1',
        contractVersion: 1, handle: `pph_${randomBytes(32).toString('hex')}`, projection: 'notes',
        currentness: { revision: patient.version, selectionEpoch: input.expectedSelectionEpoch + 1,
            observedAt, expiresAt: observedAt + 60_000 }, profile: { notes: patient.notes ?? null } };
    assertProfileResultBudget(result); return result;
}
