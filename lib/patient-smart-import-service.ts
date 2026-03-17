import { regeneratePatientSummary } from './ai-summary-service';
import { AIService } from './ai-service';
import { db, type AifaDrug, type ClinicalEntry, type Diagnosis, type DocumentInsight, type Patient, type Therapy } from './db';
import { searchICDHybrid } from './icd-service';
import { notifyDbChange } from './live-query';

export type SmartImportConfidence = 'high' | 'medium' | 'low';

export interface SmartImportEvidence {
    sourceKind: 'patient-notes' | 'clinical-entry' | 'document-insight' | 'attachment-summary';
    sourceId: string;
    label: string;
    excerpt: string;
    date?: string;
}

export interface DiagnosisSmartImportSuggestion {
    id: string;
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: SmartImportEvidence;
    explicitCode?: string;
    match?: {
        code: string;
        description: string;
        system: 'ICD-11';
    };
    canApply: boolean;
    blockedReason?: string;
}

export interface TherapySmartImportSuggestion {
    id: string;
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    confidence: SmartImportConfidence;
    evidence: SmartImportEvidence;
    matchType: 'catalog' | 'manual' | 'none';
    match?: Pick<AifaDrug, 'aic' | 'name' | 'activePrinciple' | 'atc' | 'company'>;
    canApply: boolean;
    blockedReason?: string;
}

export interface PatientSmartImportAnalysis {
    generatedAt: string;
    model: {
        provider: string;
        model: string;
    };
    sourceSummary: {
        notes: number;
        entries: number;
        documentInsights: number;
        attachmentSummaries: number;
    };
    diagnoses: DiagnosisSmartImportSuggestion[];
    therapies: TherapySmartImportSuggestion[];
}

interface SmartImportSourceRecord {
    id: string;
    kind: SmartImportEvidence['sourceKind'];
    label: string;
    date?: string;
    content: string;
}

interface ParsedAiDiagnosis {
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    explicitCode?: string;
}

interface ParsedAiTherapy {
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
}

interface ParsedAiPayload {
    diagnoses: ParsedAiDiagnosis[];
    therapies: ParsedAiTherapy[];
}

export interface ApplySmartImportResult {
    diagnosesApplied: number;
    therapiesApplied: number;
    appliedDiagnosisIds: string[];
    appliedTherapyIds: string[];
}

const SMART_IMPORT_PROMPT = `Sei un assistente clinico locale per MediFlow.

Ricevi dati gia presenti della scheda paziente e fonti recenti (note paziente, diario clinico, documenti gia analizzati).

Obiettivo: proporre suggerimenti REVIEWABLE da importare nel profilo paziente.

Restituisci SOLO JSON valido con questa forma:
{
  "diagnoses": [
    {
      "label": "patologia in italiano",
      "icdQuery": "query breve in inglese per cercare ICD-11",
      "confidence": "high|medium|low",
      "evidence": "breve evidenza testuale locale",
      "sourceId": "id della fonte usata",
      "explicitCode": "solo se la fonte contiene gia un codice esplicito"
    }
  ],
  "therapies": [
    {
      "drugMention": "farmaco o principio attivo menzionato",
      "drugQuery": "query breve per catalogo farmaci/AIFA",
      "activePrinciple": "principio attivo se disponibile",
      "dosage": "posologia se disponibile",
      "motivation": "indicazione/contesto clinico se disponibile",
      "confidence": "high|medium|low",
      "evidence": "breve evidenza testuale locale",
      "sourceId": "id della fonte usata"
    }
  ]
}

Regole:
- Non inventare dati non supportati dalle fonti.
- Non proporre diagnosi o terapie gia presenti nella scheda se equivalenti.
- Per le diagnosi free-text NON inventare codici ICD: usa label + icdQuery.
- Escludi negazioni, ipotesi non confermate, familiarita e terapie chiaramente sospese/concluse.
- Preferisci condizioni attive/rilevanti e terapie attive o presumibilmente correnti.
- Massimo 5 diagnosi e massimo 5 terapie.

CONTESTO STRUTTURATO:
`;

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length > 1);
}

function uniqueTokens(values: string[]): string[] {
    return Array.from(new Set(values));
}

function trimSnippet(value: string, maxLength = 260): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function extractJsonBlock(response: string): string | null {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    return response.slice(firstBrace, lastBrace + 1).trim();
}

function normalizeConfidence(value: unknown): SmartImportConfidence {
    if (typeof value !== 'string') return 'medium';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'medium';
}

function parseDocumentInsights(raw: Patient['documentInsights']): DocumentInsight[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as DocumentInsight[] : [];
        } catch {
            return [];
        }
    }

    return [];
}

function parseDiagnoses(raw: Patient['diagnoses']): Diagnosis[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as Diagnosis[] : [];
        } catch {
            return [];
        }
    }

    return [];
}

function normalizeDate(value: unknown): string | undefined {
    if (!value) return undefined;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildSourceRecords(
    patient: Patient,
    entries: ClinicalEntry[],
    attachments: Array<{ id: string; name: string; summarySnapshot?: string; createdAt: Date }>
): SmartImportSourceRecord[] {
    const records: SmartImportSourceRecord[] = [];

    if (patient.notes?.trim()) {
        records.push({
            id: 'patient-notes',
            kind: 'patient-notes',
            label: 'Note paziente',
            content: trimSnippet(patient.notes, 900),
        });
    }

    entries
        .filter((entry) => !entry.deletedAt && entry.content?.trim())
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
        .slice(0, 6)
        .forEach((entry) => {
            records.push({
                id: `entry:${entry.id}`,
                kind: 'clinical-entry',
                label: `${entry.type.toUpperCase()} ${new Date(entry.date).toLocaleDateString('it-IT')}`,
                date: normalizeDate(entry.date),
                content: trimSnippet(entry.content, 650),
            });
        });

    const insightFileNames = new Set<string>();
    parseDocumentInsights(patient.documentInsights)
        .slice(0, 4)
        .forEach((insight) => {
            const fileName = typeof insight.fileName === 'string' ? insight.fileName.trim() : '';
            if (fileName) insightFileNames.add(fileName.toLowerCase());

            const extractedDiagnoses = Array.isArray(insight.extractedData?.diagnoses)
                ? insight.extractedData.diagnoses
                    .map((item) => `${item.system} ${item.code} ${item.description}`)
                    .join(' | ')
                : '';

            records.push({
                id: `insight:${insight.id}`,
                kind: 'document-insight',
                label: `Documento ${fileName || 'analizzato'}`,
                date: normalizeDate(insight.date),
                content: trimSnippet(
                    [insight.summary, extractedDiagnoses].filter(Boolean).join('\n'),
                    900,
                ),
            });
        });

    attachments
        .filter((attachment) => attachment.summarySnapshot?.trim())
        .filter((attachment) => !insightFileNames.has(attachment.name.trim().toLowerCase()))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 3)
        .forEach((attachment) => {
            records.push({
                id: `attachment:${attachment.id}`,
                kind: 'attachment-summary',
                label: `Allegato ${attachment.name}`,
                date: normalizeDate(attachment.createdAt),
                content: trimSnippet(attachment.summarySnapshot || '', 500),
            });
        });

    return records;
}

function buildStructuredPrompt(
    patient: Patient,
    currentDiagnoses: Diagnosis[],
    currentTherapies: Therapy[],
    sources: SmartImportSourceRecord[]
): string {
    const payload = {
        patientId: patient.id,
        currentDiagnoses: currentDiagnoses.map((diagnosis) => ({
            system: diagnosis.system,
            code: diagnosis.code,
            description: diagnosis.description,
        })),
        currentActiveTherapies: currentTherapies
            .filter((therapy) => therapy.status === 'active')
            .map((therapy) => ({
                drugName: therapy.drugName,
                activePrinciple: therapy.activePrinciple,
                dosage: therapy.dosage,
                aic: therapy.aic,
                atc: therapy.atc,
            })),
        sources: sources.map((source) => ({
            id: source.id,
            kind: source.kind,
            label: source.label,
            date: source.date,
            content: source.content,
        })),
    };

    return `${SMART_IMPORT_PROMPT}${JSON.stringify(payload, null, 2)}`;
}

function parseAiPayload(response: string): ParsedAiPayload {
    const rawJson = extractJsonBlock(response);
    if (!rawJson) return { diagnoses: [], therapies: [] };

    try {
        const parsed = JSON.parse(rawJson) as { diagnoses?: unknown; therapies?: unknown };

        const diagnoses: ParsedAiDiagnosis[] = [];
        if (Array.isArray(parsed.diagnoses)) {
            for (const value of parsed.diagnoses) {
                if (!value || typeof value !== 'object') continue;
                const record = value as Record<string, unknown>;
                const label = typeof record.label === 'string' ? record.label.trim() : '';
                const icdQuery = typeof record.icdQuery === 'string' ? record.icdQuery.trim() : '';
                const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
                if (!label || !evidence) continue;

                diagnoses.push({
                    label,
                    icdQuery: icdQuery || label,
                    evidence,
                    sourceId: typeof record.sourceId === 'string' ? record.sourceId.trim() : undefined,
                    explicitCode: typeof record.explicitCode === 'string' ? record.explicitCode.trim().toUpperCase() : undefined,
                    confidence: normalizeConfidence(record.confidence),
                });
                if (diagnoses.length >= 5) break;
            }
        }

        const therapies: ParsedAiTherapy[] = [];
        if (Array.isArray(parsed.therapies)) {
            for (const value of parsed.therapies) {
                if (!value || typeof value !== 'object') continue;
                const record = value as Record<string, unknown>;
                const drugMention = typeof record.drugMention === 'string' ? record.drugMention.trim() : '';
                const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
                if (!drugMention || !evidence) continue;

                therapies.push({
                    drugMention,
                    drugQuery: typeof record.drugQuery === 'string' && record.drugQuery.trim()
                        ? record.drugQuery.trim()
                        : drugMention,
                    activePrinciple: typeof record.activePrinciple === 'string' ? record.activePrinciple.trim() : undefined,
                    dosage: typeof record.dosage === 'string' ? record.dosage.trim() : undefined,
                    motivation: typeof record.motivation === 'string' ? record.motivation.trim() : undefined,
                    evidence,
                    sourceId: typeof record.sourceId === 'string' ? record.sourceId.trim() : undefined,
                    confidence: normalizeConfidence(record.confidence),
                });
                if (therapies.length >= 5) break;
            }
        }

        return { diagnoses, therapies };
    } catch {
        return { diagnoses: [], therapies: [] };
    }
}

function overlapScore(candidate: string, tokens: string[]): number {
    const haystack = normalizeText(candidate);
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function rankIcdMatch(
    query: string,
    label: string,
    explicitCode: string | undefined,
    candidate: { code: string; description: string }
): number {
    if (!candidate.code || candidate.code === 'N/A') return -1;

    const queryTokens = uniqueTokens(tokenize(query));
    const labelTokens = uniqueTokens(tokenize(label));
    let score = overlapScore(candidate.description, queryTokens) * 6;
    score += overlapScore(candidate.description, labelTokens) * 4;

    if (explicitCode && candidate.code.toUpperCase() === explicitCode.toUpperCase()) {
        score += 100;
    }
    if (normalizeText(candidate.description).includes(normalizeText(label))) {
        score += 15;
    }

    return score;
}

async function resolveDiagnosisSuggestion(
    suggestion: ParsedAiDiagnosis,
    sourceMap: Map<string, SmartImportSourceRecord>
): Promise<DiagnosisSmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const query = suggestion.icdQuery || suggestion.label;
    let match: DiagnosisSmartImportSuggestion['match'];

    try {
        const results = await searchICDHybrid(query);
        const ranked = results
            .map((result) => ({
                result,
                score: rankIcdMatch(query, suggestion.label, suggestion.explicitCode, result),
            }))
            .sort((left, right) => right.score - left.score);

        const best = ranked[0];
        if (best && best.score >= 8 && best.result.code !== 'N/A') {
            match = {
                code: best.result.code,
                description: best.result.description,
                system: 'ICD-11',
            };
        }
    } catch {
        match = undefined;
    }

    return {
        id: `diagnosis:${suggestion.label}:${suggestion.explicitCode || suggestion.icdQuery}`,
        label: suggestion.label,
        icdQuery: query,
        confidence: suggestion.confidence,
        evidence: {
            sourceKind: source?.kind || 'patient-notes',
            sourceId: source?.id || 'patient-notes',
            label: source?.label || 'Fonte paziente',
            excerpt: trimSnippet(suggestion.evidence, 180),
            date: source?.date,
        },
        explicitCode: suggestion.explicitCode,
        match,
        canApply: Boolean(match),
        blockedReason: match ? undefined : 'Nessun match ICD-11 affidabile',
    };
}

async function searchDrugCatalog(query: string): Promise<AifaDrug[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const response = await fetch(`/api/drugs?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as AifaDrug[] : [];
}

function rankDrugMatch(
    candidate: AifaDrug,
    drugQuery: string,
    activePrinciple: string | undefined,
    drugMention: string
): number {
    const queryTokens = uniqueTokens(tokenize(drugQuery));
    const principleTokens = uniqueTokens(tokenize(activePrinciple || ''));
    const mentionTokens = uniqueTokens(tokenize(drugMention));
    const candidateName = `${candidate.name} ${candidate.activePrinciple || ''} ${candidate.packaging || ''}`;

    let score = overlapScore(candidateName, queryTokens) * 5;
    score += overlapScore(candidateName, principleTokens) * 7;
    score += overlapScore(candidateName, mentionTokens) * 4;

    if (activePrinciple && candidate.activePrinciple && normalizeText(candidate.activePrinciple) === normalizeText(activePrinciple)) {
        score += 18;
    }
    if (normalizeText(candidate.name).includes(normalizeText(drugMention))) {
        score += 10;
    }

    return score;
}

async function resolveTherapySuggestion(
    suggestion: ParsedAiTherapy,
    sourceMap: Map<string, SmartImportSourceRecord>
): Promise<TherapySmartImportSuggestion> {
    const source = sourceMap.get(suggestion.sourceId || '') || sourceMap.values().next().value as SmartImportSourceRecord | undefined;
    const searchTerms = uniqueTokens([suggestion.activePrinciple, suggestion.drugQuery, suggestion.drugMention].filter(Boolean) as string[]);
    let match: TherapySmartImportSuggestion['match'];
    let matchType: TherapySmartImportSuggestion['matchType'] = 'none';

    for (const term of searchTerms) {
        const candidates = await searchDrugCatalog(term);
        if (!candidates.length) continue;

        const ranked = candidates
            .map((candidate) => ({
                candidate,
                score: rankDrugMatch(candidate, suggestion.drugQuery, suggestion.activePrinciple, suggestion.drugMention),
            }))
            .sort((left, right) => right.score - left.score);

        if (ranked[0] && ranked[0].score >= 8) {
            match = {
                aic: ranked[0].candidate.aic,
                name: ranked[0].candidate.name,
                activePrinciple: ranked[0].candidate.activePrinciple,
                atc: ranked[0].candidate.atc,
                company: ranked[0].candidate.company,
            };
            matchType = 'catalog';
            break;
        }
    }

    if (!match && (suggestion.activePrinciple || suggestion.drugMention)) {
        matchType = 'manual';
    }

    return {
        id: `therapy:${suggestion.drugMention}:${suggestion.dosage || ''}:${suggestion.activePrinciple || ''}`,
        drugMention: suggestion.drugMention,
        drugQuery: suggestion.drugQuery,
        activePrinciple: suggestion.activePrinciple,
        dosage: suggestion.dosage,
        motivation: suggestion.motivation,
        confidence: suggestion.confidence,
        evidence: {
            sourceKind: source?.kind || 'patient-notes',
            sourceId: source?.id || 'patient-notes',
            label: source?.label || 'Fonte paziente',
            excerpt: trimSnippet(suggestion.evidence, 180),
            date: source?.date,
        },
        matchType,
        match,
        canApply: matchType !== 'none',
        blockedReason: matchType === 'none' ? 'Nessun match farmaco affidabile' : undefined,
    };
}

export async function generatePatientSmartImportAnalysis(patientId: string): Promise<PatientSmartImportAnalysis> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error('Paziente non trovato');

    const [entries, attachments, currentTherapies] = await Promise.all([
        db.entries.filter((entry: ClinicalEntry) => entry.patientId === patientId).toArray(),
        db.attachments.filter((attachment: { patientId: string }) => attachment.patientId === patientId).toArray(),
        db.therapies.filter((therapy: Therapy) => therapy.patientId === patientId).toArray(),
    ]);

    const sourceRecords = buildSourceRecords(patient, entries, attachments);
    if (sourceRecords.length === 0) {
        throw new Error('Nessuna sorgente disponibile per lo smart import');
    }

    const currentDiagnoses = parseDiagnoses(patient.diagnoses);
    const ai = await AIService.create('clinical');
    const prompt = buildStructuredPrompt(patient, currentDiagnoses, currentTherapies, sourceRecords);
    const response = await ai.generate(prompt, undefined, 1400);
    const parsed = parseAiPayload(response);
    const sourceMap = new Map(sourceRecords.map((source) => [source.id, source]));

    const [resolvedDiagnoses, resolvedTherapies] = await Promise.all([
        Promise.all(parsed.diagnoses.map((diagnosis) => resolveDiagnosisSuggestion(diagnosis, sourceMap))),
        Promise.all(parsed.therapies.map((therapy) => resolveTherapySuggestion(therapy, sourceMap))),
    ]);

    const diagnoses = resolvedDiagnoses.map((diagnosis) => (
        diagnosisExists(currentDiagnoses, diagnosis)
            ? {
                ...diagnosis,
                canApply: false,
                blockedReason: 'Diagnosi gia presente in scheda',
            }
            : diagnosis
    ));
    const therapySuggestions = resolvedTherapies.map((therapy) => (
        therapyExists(currentTherapies, therapy)
            ? {
                ...therapy,
                canApply: false,
                blockedReason: 'Terapia gia presente in storico',
            }
            : therapy
    ));

    return {
        generatedAt: new Date().toISOString(),
        model: {
            provider: ai.getModelInfo().provider,
            model: ai.getModelInfo().model,
        },
        sourceSummary: {
            notes: patient.notes?.trim() ? 1 : 0,
            entries: sourceRecords.filter((source) => source.kind === 'clinical-entry').length,
            documentInsights: sourceRecords.filter((source) => source.kind === 'document-insight').length,
            attachmentSummaries: sourceRecords.filter((source) => source.kind === 'attachment-summary').length,
        },
        diagnoses,
        therapies: therapySuggestions,
    };
}

function diagnosisExists(existing: Diagnosis[], suggestion: DiagnosisSmartImportSuggestion): boolean {
    if (!suggestion.match) return true;
    return existing.some((diagnosis) => (
        normalizeText(diagnosis.system) === normalizeText(suggestion.match?.system || '')
        && normalizeText(diagnosis.code) === normalizeText(suggestion.match?.code || '')
    ));
}

function normalizeTherapyKey(therapy: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'aic'>): string {
    return [
        normalizeText(therapy.aic || ''),
        normalizeText(therapy.activePrinciple || ''),
        normalizeText(therapy.drugName || ''),
        normalizeText(therapy.dosage || ''),
    ].join('|');
}

function therapyExists(existing: Therapy[], suggestion: TherapySmartImportSuggestion): boolean {
    const probe: Pick<Therapy, 'drugName' | 'activePrinciple' | 'dosage' | 'aic'> = {
        drugName: suggestion.match?.name || suggestion.drugMention,
        activePrinciple: suggestion.match?.activePrinciple || suggestion.activePrinciple,
        dosage: suggestion.dosage || '',
        aic: suggestion.match?.aic,
    };
    const probeKey = normalizeTherapyKey(probe);

    return existing.some((therapy) => normalizeTherapyKey(therapy) === probeKey);
}

export async function applyPatientSmartImportSelection(
    patientId: string,
    analysis: PatientSmartImportAnalysis,
    selection: {
        diagnosisIds: string[];
        therapyIds: string[];
    }
): Promise<ApplySmartImportResult> {
    const patient = await db.patients.get(patientId);
    if (!patient) throw new Error('Paziente non trovato');
    if (typeof patient.version !== 'number') {
        throw new Error('Missing patient version for smart import apply.');
    }

    const selectedDiagnoses = analysis.diagnoses.filter((diagnosis) => selection.diagnosisIds.includes(diagnosis.id));
    const selectedTherapies = analysis.therapies.filter((therapy) => selection.therapyIds.includes(therapy.id));

    const existingDiagnoses = parseDiagnoses(patient.diagnoses);
    const existingTherapies = await db.therapies.filter((therapy: Therapy) => therapy.patientId === patientId).toArray();
    const nextDiagnoses = [...existingDiagnoses];
    const appliedDiagnosisIds: string[] = [];

    for (const suggestion of selectedDiagnoses) {
        if (!suggestion.canApply || !suggestion.match) continue;
        if (diagnosisExists(nextDiagnoses, suggestion)) continue;

        nextDiagnoses.push({
            system: suggestion.match.system,
            code: suggestion.match.code,
            description: suggestion.match.description,
            date: new Date(),
        });
        appliedDiagnosisIds.push(suggestion.id);
    }

    const therapyItems: Therapy[] = [];
    const appliedTherapyIds: string[] = [];
    for (const suggestion of selectedTherapies) {
        if (!suggestion.canApply) continue;
        if (therapyExists([...existingTherapies, ...therapyItems], suggestion)) continue;

        therapyItems.push({
            id: crypto.randomUUID(),
            patientId,
            drugName: suggestion.match?.name || suggestion.drugMention,
            aic: suggestion.match?.aic,
            atc: suggestion.match?.atc,
            activePrinciple: suggestion.match?.activePrinciple || suggestion.activePrinciple,
            dosage: suggestion.dosage || 'Posologia da verificare',
            motivation: suggestion.motivation || suggestion.evidence.excerpt,
            status: 'active',
            startDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        appliedTherapyIds.push(suggestion.id);
    }

    const createdTherapyIds: string[] = [];
    try {
        for (const therapyItem of therapyItems) {
            await db.therapies.add(therapyItem, { suppressNotify: true });
            createdTherapyIds.push(therapyItem.id);
        }

        if (appliedDiagnosisIds.length > 0) {
            await db.patients.update(patientId, {
                diagnoses: nextDiagnoses,
                version: patient.version,
                updatedAt: new Date(),
            });
        } else if (createdTherapyIds.length > 0) {
            notifyDbChange();
        }
    } catch (error) {
        for (const therapyId of createdTherapyIds) {
            await db.therapies.delete(therapyId, { suppressNotify: true }).catch(() => null);
        }
        if (createdTherapyIds.length > 0) {
            notifyDbChange();
        }
        throw error;
    }

    if (appliedDiagnosisIds.length > 0 || appliedTherapyIds.length > 0) {
        await regeneratePatientSummary(patientId).catch(() => null);
    }

    return {
        diagnosesApplied: appliedDiagnosisIds.length,
        therapiesApplied: appliedTherapyIds.length,
        appliedDiagnosisIds,
        appliedTherapyIds,
    };
}
