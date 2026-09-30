// Fixed invented examples. Receipt-shaped objects are fixtures, never authorization.
const hex = (character) => character.repeat(64);
const digest = (character) => `sha256:${hex(character)}`;
const operationId = 'mediflow.patient.open_loops.follow_up.propose.v1';
export const proposalFixture = {
  schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.v1',
  operationId, capabilityId: operationId,
  applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1',
  outcome: 'proposed', maximumStage: 'proposal_only', reviewRequired: true,
  writesPerformed: 0, apply: 'none', proposalRef: `aipfp_${hex('a')}`,
  basedOnSnapshotRevision: 1,
  items: [
    { loopRef: `aipl_${hex('b')}`, action: 'review_result' },
    { loopRef: `aipl_${hex('c')}`, action: 'review_expected_follow_up' },
  ],
  receipt: {
    schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.receipt.v1',
    receiptRef: `aipfr_${hex('d')}`, operationId, capabilityId: operationId,
    applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1',
    outcome: 'proposed', proposalRefHash: digest('a'), receiptRefHash: digest('d'),
    sourceReceiptRefHash: digest('e'), basedOnSnapshotRevision: 1,
    itemCount: 2, truncated: false, maximumStage: 'proposal_only',
    reviewRequired: true, writesPerformed: 0, apply: 'none', egress: 'none',
    timestamp: 1790762400000,
  },
};
export const examples = Object.freeze([
  Object.freeze({ id: 'demo-result', title: 'Risultato da revisionare',
    excerpt: 'ESEMPIO INVENTATO: un risultato di laboratorio è disponibile. Il medico deve leggerlo prima di decidere il passo successivo.' }),
  Object.freeze({ id: 'demo-follow-up', title: 'Controllo da valutare',
    excerpt: 'ESEMPIO INVENTATO: un controllo pianificato richiede una revisione. Questo esempio non prenota visite e non modifica cartelle cliniche.' }),
]);
export function viewModel(view) {
  return { schemaVersion: 'mediflow.synthetic.review.v1', synthetic: true,
    view, examples, proposalFixture: structuredClone(proposalFixture),
    clinicalDataAccess: false, writesPerformed: 0, apply: 'none' };
}
