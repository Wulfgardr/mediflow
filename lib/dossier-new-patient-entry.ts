import { evaluateDraftGroupIdentity, type DossierDraftGroup, type DossierDraftSource, type DossierPatient } from './document-dossier-session';
import { proposeIdentityFields, type DossierIdentityProposal } from './domain/documents/dossier-sections';

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

export type IdentityField = DossierIdentityProposal['field'];
export type SourcedIdentityProposal = DossierIdentityProposal & Readonly<{ sourceName: string }>;
export const IDENTITY_FIELDS: readonly IdentityField[] = ['taxCode', 'lastName', 'firstName', 'birthDate'];

function sourceIdentityProposals(source: DossierDraftSource): DossierIdentityProposal[] {
    const found = proposeIdentityFields(source.text ?? '', dossierPatientCode(source));
    const patient = source.prepared?.patient;
    if (!patient) return found;
    const have = new Set(found.map((proposal) => proposal.field));
    const prepared = IDENTITY_FIELDS
        .filter((field) => !have.has(field) && patient[field])
        .map((field) => ({ field, value: patient[field]!, excerpt: `Dall’estrazione preparata: ${patient[field]}` }));
    return [...found, ...prepared];
}

export function sameIdentityValue(a: string, b: string): boolean {
    const normal = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleUpperCase('it-IT');
    return normal(a) === normal(b);
}

export function groupIdentityProposals(group: DossierDraftGroup, firstSourceKey: string): SourcedIdentityProposal[] {
    const sources = group.sources.filter((source) => source.status === 'ready');
    const ordered = [...sources.filter((source) => source.key === firstSourceKey), ...sources.filter((source) => source.key !== firstSourceKey)];
    const proposals: SourcedIdentityProposal[] = [];
    for (const source of ordered) {
        for (const proposal of sourceIdentityProposals(source)) {
            if (proposals.some((kept) => kept.field === proposal.field && sameIdentityValue(kept.value, proposal.value))) continue;
            proposals.push({ ...proposal, sourceName: source.fileName });
        }
    }
    return proposals;
}

export type AllIdentityProposals = Readonly<{ values: Partial<Record<IdentityField, string>>; undecided: IdentityField[] }>;

export function allIdentityProposals(proposals: readonly DossierIdentityProposal[]): AllIdentityProposals {
    const values: Partial<Record<IdentityField, string>> = {};
    const undecided: IdentityField[] = [];
    for (const field of IDENTITY_FIELDS) {
        const offered = proposals.filter((proposal) => proposal.field === field);
        if (!offered.length) continue;
        if (offered.every((proposal) => sameIdentityValue(proposal.value, offered[0].value))) values[field] = offered[0].value;
        else undecided.push(field);
    }
    return { values, undecided };
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
