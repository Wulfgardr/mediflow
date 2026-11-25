import { evaluateDraftGroupIdentity, type DossierDraftGroup, type DossierDraftSource, type DossierPatient } from './document-dossier-session';
import { proposeIdentityFields } from './domain/documents/dossier-sections';

export const PATIENT_DOCUMENT_CREATE_MAX_BYTES = 10 * 1024 * 1024;

export function dossierCreationCandidates(group: DossierDraftGroup): DossierDraftSource[] {
    return group.sources.filter((source) => source.status === 'ready' && source.classification.kind === 'pdf' && source.size <= PATIENT_DOCUMENT_CREATE_MAX_BYTES);
}

export function dossierPatientCode(source: DossierDraftSource): string | null {
    return source.taxCodes.find((code) => code.role === 'patient_cf' && code.checksumValid)?.value ?? null;
}

function identityEvidence(source: DossierDraftSource): number {
    return proposeIdentityFields(source.text ?? '', dossierPatientCode(source)).length;
}

export type NewPatientDossierStart =
    | { kind: 'create'; groupKey: string; sourceKey: string }
    | { kind: 'review'; reason: 'several_groups' | 'identity_blocked' | 'existing_patient' | 'no_pdf' };

export function newPatientDossierStart(groups: readonly DossierDraftGroup[], patients: readonly DossierPatient[]): NewPatientDossierStart {
    const writable = groups.filter((group) => group.sources.some((source) => source.status === 'ready'));
    if (writable.length !== 1) return { kind: 'review', reason: 'several_groups' };
    const [group] = writable;
    const identity = evaluateDraftGroupIdentity(group, patients, null);
    if (identity.blocking) return { kind: 'review', reason: 'identity_blocked' };
    if (identity.candidatePatientIds.length) return { kind: 'review', reason: 'existing_patient' };
    const candidates = dossierCreationCandidates(group);
    const source = candidates.reduce<DossierDraftSource | undefined>((best, item) => !best || identityEvidence(item) > identityEvidence(best) ? item : best, undefined);
    return source ? { kind: 'create', groupKey: group.key, sourceKey: source.key } : { kind: 'review', reason: 'no_pdf' };
}

const SINGLE_DOCUMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

export function loneDocumentImage<T extends { type: string }>(files: readonly T[]): T | null {
    return files.length === 1 && SINGLE_DOCUMENT_IMAGE_TYPES.has(files[0].type) ? files[0] : null;
}
