/* @Codex */
export const LAB_RESULT_ARTIFACT_SCHEMA_VERSION = 'mediflow.lab_result_artifact.v1';
const LEGACY_SCHEMA_VERSION = 'mediflow.document_evidence_pack.v2';
type Source = { documentInsightId: string; fileName: string; documentDate: string; qualityLevel?: 'green' | 'yellow' | 'red' };
type Proposal = { requestId: string; codeSystem: 'LOINC'; code: string; display: string; unitCode: string; value: string; refLow?: string; refHigh?: string };
type LabResult = { analyte: string; value: string; unit: string; referenceRange: { text: string; low?: string; high?: string }; flag?: 'basso' | 'alto'; lineNumber: number; sourceLine: string };
export type LabResultFact = { id: string; kind: 'lab_result'; label: string; excerpt: string; sourceId: string; temporality: 'current'; status: 'active'; origin: 'documented'; labResult: LabResult; code?: string; system?: 'LOINC'; observationProposal?: Proposal };
export type LabResultArtifact = { schemaVersion: typeof LAB_RESULT_ARTIFACT_SCHEMA_VERSION; reviewStatus: 'review_only'; source: Source; facts: LabResultFact[] };

/* @Codex */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const only = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const optionalString = (value: unknown) => value === undefined || nonEmpty(value);

/* @Codex */
function readSource(value: unknown): Source | undefined {
    if (!isRecord(value) || !only(value, ['documentInsightId', 'fileName', 'documentDate', 'qualityLevel'])) return undefined;
    if (![value.documentInsightId, value.fileName, value.documentDate].every(nonEmpty)) return undefined;
    if (value.qualityLevel !== undefined && !['green', 'yellow', 'red'].includes(value.qualityLevel as string)) return undefined;
    return value.qualityLevel === undefined
        ? { documentInsightId: value.documentInsightId as string, fileName: value.fileName as string, documentDate: value.documentDate as string }
        : { documentInsightId: value.documentInsightId as string, fileName: value.fileName as string, documentDate: value.documentDate as string, qualityLevel: value.qualityLevel as Source['qualityLevel'] };
}

/* @Codex */
function readFact(value: unknown, source: Source): LabResultFact | undefined {
    if (!isRecord(value) || !only(value, ['id', 'kind', 'label', 'excerpt', 'sourceId', 'temporality', 'status', 'origin', 'labResult', 'code', 'system', 'observationProposal'])) return undefined;
    if (value.kind !== 'lab_result' || value.temporality !== 'current' || value.status !== 'active' || value.origin !== 'documented' || ![value.id, value.label, value.excerpt, value.sourceId].every(nonEmpty) || value.sourceId !== source.documentInsightId) return undefined;
    const lab = value.labResult;
    if (!isRecord(lab) || !only(lab, ['analyte', 'value', 'unit', 'referenceRange', 'flag', 'lineNumber', 'sourceLine']) || ![lab.analyte, lab.value, lab.unit, lab.sourceLine].every(nonEmpty) || !Number.isInteger(lab.lineNumber) || (lab.lineNumber as number) < 1) return undefined;
    const range = lab.referenceRange;
    if (!isRecord(range) || !only(range, ['text', 'low', 'high']) || !nonEmpty(range.text) || !optionalString(range.low) || !optionalString(range.high) || (lab.flag !== undefined && lab.flag !== 'basso' && lab.flag !== 'alto')) return undefined;
    const rawProposal = value.observationProposal;
    if (rawProposal !== undefined && (!isRecord(rawProposal) || !only(rawProposal, ['requestId', 'codeSystem', 'code', 'display', 'unitCode', 'value', 'refLow', 'refHigh']) || rawProposal.codeSystem !== 'LOINC' || ![rawProposal.requestId, rawProposal.code, rawProposal.display, rawProposal.unitCode, rawProposal.value].every(nonEmpty) || !optionalString(rawProposal.refLow) || !optionalString(rawProposal.refHigh) || value.system !== 'LOINC' || value.code !== rawProposal.code || rawProposal.value !== lab.value || rawProposal.unitCode !== lab.unit || rawProposal.refLow !== range.low || rawProposal.refHigh !== range.high || rawProposal.requestId !== `lab_result:${lab.lineNumber}:${rawProposal.code}`)) return undefined;
    if (rawProposal === undefined && (value.code !== undefined || value.system !== undefined)) return undefined;
    const proposal = rawProposal as Proposal | undefined;
    return { id: value.id as string, kind: 'lab_result', label: value.label as string, excerpt: value.excerpt as string, sourceId: value.sourceId as string, temporality: 'current', status: 'active', origin: 'documented', labResult: { analyte: lab.analyte as string, value: lab.value as string, unit: lab.unit as string, referenceRange: { text: range.text as string, ...(range.low ? { low: range.low as string } : {}), ...(range.high ? { high: range.high as string } : {}) }, ...(lab.flag ? { flag: lab.flag as 'basso' | 'alto' } : {}), lineNumber: lab.lineNumber as number, sourceLine: lab.sourceLine as string }, ...(proposal ? { code: proposal.code, system: 'LOINC' as const, observationProposal: { ...proposal } } : {}) };
}

/* @Codex */
export function readLabResultArtifact(value: unknown): LabResultArtifact | undefined {
    if (!isRecord(value)) return undefined;
    const legacy = value.schemaVersion === LEGACY_SCHEMA_VERSION;
    if (value.schemaVersion !== LAB_RESULT_ARTIFACT_SCHEMA_VERSION && !legacy) return undefined;
    if (!only(value, legacy ? ['schemaVersion', 'source', 'facts', 'sourceGovernance'] : ['schemaVersion', 'reviewStatus', 'source', 'facts']) || (!legacy && value.reviewStatus !== 'review_only') || !Array.isArray(value.facts)) return undefined;
    const source = readSource(value.source);
    if (!source) return undefined;
    const facts: LabResultFact[] = [];
    for (const item of value.facts) {
        if (!isRecord(item) || !['problem', 'medication', 'followup', 'care_setting', 'functional_status', 'lab_result'].includes(item.kind as string)) return undefined;
        if (!legacy && item.kind !== 'lab_result') return undefined;
        if (item.kind === 'lab_result') { const fact = readFact(item, source); if (!fact) return undefined; facts.push(fact); }
    }
    return facts.length ? { schemaVersion: LAB_RESULT_ARTIFACT_SCHEMA_VERSION, reviewStatus: 'review_only', source, facts } : undefined;
}
