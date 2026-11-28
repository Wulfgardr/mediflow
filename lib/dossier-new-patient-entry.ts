import { evaluateDraftGroupIdentity, type DossierDraftGroup, type DossierDraftSource, type DossierPatient } from './document-dossier-session';
import { proposeIdentityFields, proposeSpokenIdentityFields, type DossierIdentityProposal } from './domain/documents/dossier-sections';
import { collectDossierPatientNames, patientNameWords } from './domain/documents/dossier-import';
import type { DossierBatchIdentity } from './patient-document-batch-contract';
import { birthDateMatchesTaxCode } from './patient-identity';

export const PATIENT_DOCUMENT_CREATE_MAX_BYTES = 10 * 1024 * 1024;

export function dossierCreationCandidates(group: DossierDraftGroup): DossierDraftSource[] {
    return group.sources.filter((source) => source.status === 'ready' && source.classification.kind === 'pdf' && source.size <= PATIENT_DOCUMENT_CREATE_MAX_BYTES);
}

export function dossierPatientCode(source: DossierDraftSource): string | null {
    return source.taxCodes.find((code) => code.role === 'patient_cf' && code.checksumValid)?.value ?? null;
}

function textIdentityProposals(source: DossierDraftSource): DossierIdentityProposal[] {
    const read = source.file.origin === 'visit-transcript' ? proposeSpokenIdentityFields : proposeIdentityFields;
    return read(source.text ?? '', dossierPatientCode(source));
}

export function sourceConfirmsBatchIdentity(source: DossierDraftSource, identity: DossierBatchIdentity): boolean {
    const proposals = textIdentityProposals(source);
    const confirms = (field: IdentityField) => proposals.some(proposal => proposal.field === field && sameIdentityValue(proposal.value, identity[field]));
    if (!confirms('taxCode') || !confirms('birthDate') || !identity.firstName || !identity.lastName) return false;
    if (confirms('firstName') && confirms('lastName')) return true;
    const expected = patientNameWords(identity).sort().join(' ');
    const written = collectDossierPatientNames(source.text ?? '', true);
    return written.length > 0 && written.every(name => name.toSorted().join(' ') === expected);
}

function identityEvidence(source: DossierDraftSource): number {
    return textIdentityProposals(source).length;
}

export type IdentityField = DossierIdentityProposal['field'];
export type SourcedIdentityProposal = DossierIdentityProposal & Readonly<{ sourceName: string; sourceKeys: readonly string[] }>;
export const IDENTITY_FIELDS: readonly IdentityField[] = ['taxCode', 'lastName', 'firstName', 'birthDate'];

function sourceIdentityProposals(source: DossierDraftSource): DossierIdentityProposal[] {
    const found = textIdentityProposals(source);
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
    const proposals: (DossierIdentityProposal & { sourceName: string; sourceKeys: string[] })[] = [];
    for (const source of ordered) {
        for (const proposal of sourceIdentityProposals(source)) {
            const kept = proposals.find((item) => item.field === proposal.field && sameIdentityValue(item.value, proposal.value));
            if (!kept) proposals.push({ ...proposal, sourceName: source.fileName, sourceKeys: [source.key] });
            else if (!kept.sourceKeys.includes(source.key)) kept.sourceKeys.push(source.key);
        }
    }
    return proposals.sort((a, b) => IDENTITY_FIELDS.indexOf(a.field) - IDENTITY_FIELDS.indexOf(b.field));
}

export type AllIdentityProposals = Readonly<{ values: Partial<Record<IdentityField, string>>; undecided: IdentityField[]; leftOut: IdentityField[] }>;

export function allIdentityProposals(proposals: readonly SourcedIdentityProposal[]): AllIdentityProposals {
    const values: Partial<Record<IdentityField, string>> = {};
    const undecided: IdentityField[] = [];
    for (const field of IDENTITY_FIELDS) {
        const offered = proposals.filter((proposal) => proposal.field === field);
        if (!offered.length) continue;
        if (offered.every((proposal) => sameIdentityValue(proposal.value, offered[0].value))) values[field] = offered[0].value;
        else undecided.push(field);
    }
    if (values.taxCode && values.birthDate && !birthDateMatchesTaxCode(values.taxCode, values.birthDate)) {
        delete values.birthDate;
        undecided.push('birthDate');
    }
    const backers = (field: IdentityField) => {
        const value = values[field];
        return value === undefined ? [] : proposals.find((proposal) => proposal.field === field && sameIdentityValue(proposal.value, value))?.sourceKeys ?? [];
    };
    const samePerson = new Set([...backers('taxCode'), ...backers('lastName').filter((key) => backers('firstName').includes(key))]);
    const singleSource = new Set(proposals.flatMap((proposal) => proposal.sourceKeys)).size === 1;
    const leftOut = IDENTITY_FIELDS.filter((field) => values[field] !== undefined && !singleSource
        && !backers(field).some((key) => samePerson.has(key))
        && !(field === 'birthDate' && values.taxCode && birthDateMatchesTaxCode(values.taxCode, values.birthDate!)));
    for (const field of leftOut) delete values[field];
    return { values, undecided, leftOut };
}

export type UndecidedReason = 'different-values' | 'birth-date-not-in-tax-code';

export function undecidedReason(proposals: readonly DossierIdentityProposal[], field: IdentityField): UndecidedReason {
    const offered = proposals.filter((proposal) => proposal.field === field);
    return offered.every((proposal) => sameIdentityValue(proposal.value, offered[0].value)) && field === 'birthDate'
        ? 'birth-date-not-in-tax-code' : 'different-values';
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
