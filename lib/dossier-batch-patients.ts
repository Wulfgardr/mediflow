import { dossierCreationCandidates, groupIdentityProposals, IDENTITY_FIELDS } from './dossier-new-patient-entry';
import { dossierGroupDestination, evaluateDraftGroupIdentity, type DossierDraftGroup, type DossierDraftSource, type DossierPatient } from './document-dossier-session';
import { excludedProfessionalCode } from './domain/documents/dossier-import';
import type { DossierBatchIdentity } from './patient-document-batch-contract';

export type DossierBatchProposal = {
    groupKey: string;
    source: DossierDraftSource;
    identity: DossierBatchIdentity;
    blocked: string | null;
};

export function dossierBatchProposals(groups: readonly DossierDraftGroup[], patients: readonly DossierPatient[],
    links: Readonly<Record<string, string>>): DossierBatchProposal[] {
    return groups.flatMap(group => {
        if (dossierGroupDestination(group, patients, links[group.key])) return [];
        const identity = evaluateDraftGroupIdentity(group, patients, null);
        const uncertain = new Set(identity.uncertainDocuments?.map(document => document.key));
        const candidates = dossierCreationCandidates(group);
        const source = candidates.find(item => !uncertain.has(item.key) && item.taxCodes.some(code => code.role === 'patient_cf'))
            ?? candidates.find(item => !uncertain.has(item.key)) ?? candidates[0];
        if (!source) return [];
        const proposals = groupIdentityProposals(group, source.key);
        const values = Object.fromEntries(IDENTITY_FIELDS.map(field => {
            const offered = proposals.filter(item => item.field === field);
            return [field, offered.length === 1 && offered[0].sourceKeys.includes(source.key) ? offered[0].value : ''];
        })) as Record<keyof DossierBatchIdentity, string>;
        const codes = source.taxCodes.filter(code => !excludedProfessionalCode(code) && code.value !== group.physicianTaxCode);
        if (!values.taxCode && codes.length === 1 && !codes[0].checksumValid) values.taxCode = codes[0].value;
        return [{ groupKey: group.key, source, identity: values,
            blocked: identity.blocking ? identity.message
                : uncertain.has(source.key) ? 'Il codice fiscale nel documento è da attribuire.' : null }];
    });
}
