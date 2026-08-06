/* @Codex */
export const CLINICAL_RESULT_IMPORT_SCHEMA = 'mediflow.clinical_result_import.v1' as const;

export type ImportLane = 'deterministic' | 'local' | 'cloud';
export type ExplicitResultFlag = 'low' | 'high' | 'critical';

export interface RawClinicalResult {
  analyte: string;
  value: string | number;
  unit?: string;
  referenceRange?: string;
  observedAt: string;
  laboratory?: string;
  specimen?: string;
  reportId?: string;
  explicitFlag?: ExplicitResultFlag;
  loinc?: string;
  ucum?: string;
}

export interface VerifiedTerminology {
  analyte: string;
  loinc: string;
  unit?: string;
  ucum?: string;
  verified: true;
}

export interface ClinicalResultCandidate {
  idempotencyKey: string;
  analyte: { original: string; normalized: string; loinc?: string };
  value: string;
  unit: { original?: string; ucum?: string };
  referenceRange?: { original: string; low?: number; high?: number };
  explicitFlag?: ExplicitResultFlag;
  observedAt: string;
  laboratory?: string;
  specimen?: string;
  reportId?: string;
  provenance: { documentHash: string; lane: ImportLane };
  confidence: { score: number; reason: string };
}

export interface ClinicalResultImportEnvelope {
  schema: typeof CLINICAL_RESULT_IMPORT_SCHEMA;
  mode: 'review_only';
  patientId: string;
  documentHash: string;
  candidates: ClinicalResultCandidate[];
  issues: string[];
}

const normalizeText = (value: string): string =>
  value.normalize('NFKC').trim().toLocaleLowerCase('it-IT').replace(/\s+/g, ' ');

const normalizeValue = (value: string | number): string =>
  String(value).trim().replace(',', '.');

const tinyHash = (value: string): string => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const parseRange = (original?: string): ClinicalResultCandidate['referenceRange'] => {
  if (!original) return undefined;
  const normalized = original.replaceAll(',', '.').trim();
  const between = normalized.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/);
  if (between) return { original, low: Number(between[1]), high: Number(between[2]) };
  const upper = normalized.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (upper) return { original, high: Number(upper[1]) };
  const lower = normalized.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (lower) return { original, low: Number(lower[1]) };
  return { original };
};

export function normalizeClinicalResult(
  raw: RawClinicalResult,
  documentHash: string,
  lane: ImportLane,
  terminology: VerifiedTerminology[] = [],
): ClinicalResultCandidate {
  const analyte = normalizeText(raw.analyte);
  const exact = terminology.find(item => normalizeText(item.analyte) === analyte);
  const loinc = exact?.loinc;
  const ucum = exact && (!exact.unit || normalizeText(exact.unit) === normalizeText(raw.unit ?? ''))
    ? exact.ucum
    : undefined;
  const value = normalizeValue(raw.value);
  const observedAt = new Date(raw.observedAt).toISOString();
  const identity = [
    documentHash,
    raw.reportId ?? '',
    loinc ?? analyte,
    observedAt,
    value,
    ucum ?? normalizeText(raw.unit ?? ''),
  ].join('|');
  return {
    idempotencyKey: `clinical-result:${tinyHash(identity)}:${tinyHash(documentHash)}`,
    analyte: { original: raw.analyte, normalized: analyte, ...(loinc ? { loinc } : {}) },
    value,
    unit: { ...(raw.unit ? { original: raw.unit } : {}), ...(ucum ? { ucum } : {}) },
    ...(raw.referenceRange ? { referenceRange: parseRange(raw.referenceRange) } : {}),
    ...(raw.explicitFlag ? { explicitFlag: raw.explicitFlag } : {}),
    observedAt,
    ...(raw.laboratory ? { laboratory: raw.laboratory } : {}),
    ...(raw.specimen ? { specimen: raw.specimen } : {}),
    ...(raw.reportId ? { reportId: raw.reportId } : {}),
    provenance: { documentHash, lane },
    confidence: {
      score: lane === 'deterministic' ? 1 : 0.65,
      reason: lane === 'deterministic' ? 'campi normalizzati da evidenza strutturata' : 'proposta provider da revisionare',
    },
  };
}

export function buildClinicalResultImportEnvelope(input: {
  patientId: string;
  documentHash: string;
  deterministic: RawClinicalResult[];
  provider?: { lane: Exclude<ImportLane, 'deterministic'>; results: RawClinicalResult[] };
  terminology?: VerifiedTerminology[];
}): ClinicalResultImportEnvelope {
  const stable = input.deterministic.map(item =>
    normalizeClinicalResult(item, input.documentHash, 'deterministic', input.terminology));
  const candidates = [...stable];
  const issues: string[] = [];
  for (const raw of input.provider?.results ?? []) {
    const proposal = normalizeClinicalResult(
      raw,
      input.documentHash,
      input.provider!.lane,
      input.terminology,
    );
    const sameFact = stable.find(item =>
      item.analyte.normalized === proposal.analyte.normalized
      && item.observedAt === proposal.observedAt);
    if (sameFact) {
      if (sameFact.value !== proposal.value || sameFact.unit.original !== proposal.unit.original) {
        issues.push(`provider_conflict:${sameFact.idempotencyKey}`);
      }
      continue;
    }
    candidates.push(proposal);
  }
  return {
    schema: CLINICAL_RESULT_IMPORT_SCHEMA,
    mode: 'review_only',
    patientId: input.patientId,
    documentHash: input.documentHash,
    candidates,
    issues,
  };
}

export interface ClinicalResultSeries {
  key: string;
  all: ClinicalResultCandidate[];
  collapsed: ClinicalResultCandidate[];
}

export function buildClinicalResultSeries(
  patientId: string,
  observations: ClinicalResultCandidate[],
): ClinicalResultSeries[] {
  const unique = new Map(observations.map(item => [item.idempotencyKey, item]));
  const groups = new Map<string, ClinicalResultCandidate[]>();
  for (const item of unique.values()) {
    const key = `${patientId}|${item.analyte.loinc ?? item.analyte.normalized}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, allUnsorted]) => {
    const all = allUnsorted.toSorted((a, b) => b.observedAt.localeCompare(a.observedAt));
    const collapsed = all.slice(0, 3);
    const recentYears = new Set(collapsed.map(item => new Date(item.observedAt).getUTCFullYear()));
    const olderYears = new Set<number>();
    for (const item of all.slice(3)) {
      const year = new Date(item.observedAt).getUTCFullYear();
      if (!recentYears.has(year) && !olderYears.has(year)) {
        collapsed.push(item);
        olderYears.add(year);
      }
    }
    return { key, all, collapsed };
  });
}

export interface PrescriptionCandidate {
  id: string;
  code?: string;
  description: string;
  prescribedAt: string;
  reportId?: string;
}

export type PrescriptionLinkProposal =
  | { state: 'collegato'; prescriptionId: string; reason: string }
  | { state: 'ambiguo'; prescriptionIds: string[]; reason: string }
  | { state: 'non_collegato'; reason: string };

export function proposePrescriptionLink(
  result: ClinicalResultCandidate,
  prescriptions: PrescriptionCandidate[],
  windowDays = 90,
): PrescriptionLinkProposal {
  const observed = new Date(result.observedAt).getTime();
  const matches = prescriptions.filter(item => {
    const exactIdentity = Boolean(
      result.analyte.loinc && item.code === result.analyte.loinc,
    ) || normalizeText(item.description) === result.analyte.normalized;
    const temporal = Math.abs(observed - new Date(item.prescribedAt).getTime()) <= windowDays * 86_400_000;
    const reportCompatible = !item.reportId || item.reportId === result.reportId;
    return exactIdentity && temporal && reportCompatible;
  });
  if (matches.length === 1) {
    return { state: 'collegato', prescriptionId: matches[0].id, reason: 'identità esatta e finestra temporale' };
  }
  if (matches.length > 1) {
    return { state: 'ambiguo', prescriptionIds: matches.map(item => item.id), reason: 'più prescrizioni compatibili' };
  }
  return { state: 'non_collegato', reason: 'evidenza insufficiente' };
}
