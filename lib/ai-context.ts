import { db, type Diagnosis, type DocumentInsight } from '@/lib/db';
import {
    estimateAIInsightComplexityScore,
    getAIInsightRuntimeSettings,
} from '@/lib/ai-insight-settings';
/* @Codex */
import { parsePatientDatedRecords } from '@/lib/patient-structured-fields';
import { calculateAge, estimateBirthYearFromTaxCode } from '@/lib/utils';

export interface PatientContext {
    summary: string;
    found: boolean;
    patientName?: string;
}

/* @Codex */
export interface PatientInsightSourceRef {
    id: string;
    section: string;
    label: string;
    promptLine: string;
}

/* @Codex */
export interface PatientInsightContextSnapshot {
    prompt: string;
    sourceRefs: PatientInsightSourceRef[];
    limitations: string[];
    outputMaxTokens: number;
    patientName: {
        firstName: string;
        lastName: string;
    };
}

const MAX_ENTRIES = 5;
const MAX_THERAPIES = 5;
const MAX_OBSERVATIONS = 5;
const MAX_CHECKUPS = 5;
const MAX_DIAGNOSES = 5;
const DOCUMENT_SOURCE_SUMMARY_CHARS = 600;

const CONTAMINATED_NOTE_MARKERS = [
    '**quadro attuale:**',
    '**attenzioni:**',
    '**prossimi passi:**',
    '**gap da chiarire:**',
    '**fonti usate per i claim:**',
    '**limiti noti:**',
    '**riassunto clinico:**',
];

function compactText(value: string | null | undefined, maxChars = 220): string {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function formatDate(value: unknown): string {
    if (!value) return '';
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('it-IT');
}

function compareDatesDesc(left: unknown, right: unknown): number {
    const leftTime = new Date(left as string | number | Date).getTime();
    const rightTime = new Date(right as string | number | Date).getTime();
    return rightTime - leftTime;
}

function buildAge(birthDate?: Date, taxCode?: string): string {
    if (birthDate) {
        return (new Date().getFullYear() - new Date(birthDate).getFullYear()).toString();
    }

    if (taxCode) {
        const estimatedYear = estimateBirthYearFromTaxCode(taxCode);
        if (estimatedYear) return calculateAge(estimatedYear).toString();
    }

    return 'N/A';
}

function isNarrativeNoteContaminated(value: string | null | undefined): boolean {
    const raw = value ?? '';
    const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) return false;

    return CONTAMINATED_NOTE_MARKERS.some((marker) => normalized.includes(marker))
        || /\[(?:s\d+|dati-incompleti)(?:,\s*(?:s\d+|dati-incompleti))*\]/i.test(raw);
}

function normalizeEvidenceLine(line: string): string {
    return line.replace(/^-\s+/, '').trim();
}

function createSourceRefs(
    section: string,
    lines: string[],
    nextIndex: number,
): { refs: PatientInsightSourceRef[]; nextIndex: number } {
    const refs = lines
        .map(normalizeEvidenceLine)
        .filter((line) => line.length > 0)
        .map((promptLine, offset) => ({
            id: `S${nextIndex + offset}`,
            section,
            label: `${section}: ${compactText(promptLine, 160)}`,
            promptLine,
        }));

    return {
        refs,
        nextIndex: nextIndex + refs.length,
    };
}

function renderSourceRefs(refs: PatientInsightSourceRef[]): string {
    return refs.map((ref) => `[${ref.id}] ${ref.promptLine}`).join('\n');
}

/* @Codex */
export async function buildPatientInsightContext(patientId: string): Promise<PatientInsightContextSnapshot> {
    const patient = await db.patients.get(patientId);
    if (!patient) {
        return {
            prompt: '',
            sourceRefs: [],
            limitations: ['Paziente non trovato nel database locale.'],
            outputMaxTokens: 512,
            patientName: { firstName: '', lastName: '' },
        };
    }

    const age = buildAge(patient.birthDate, patient.taxCode);
    const allDiagnoses = parsePatientDatedRecords<Diagnosis>(patient.diagnoses)
        .sort((left, right) => compareDatesDesc(left.date, right.date));
    const diagnoses = allDiagnoses.slice(0, MAX_DIAGNOSES);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allEntries = await db.entries.filter((entry: any) => entry.patientId === patient.id).toArray();
    const activeEntries = allEntries
        .filter((entry) => !entry.deletedAt && entry.content?.trim())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((left: any, right: any) => compareDatesDesc(left.date, right.date));
    const entries = activeEntries.slice(0, MAX_ENTRIES);

    const therapies = await db.therapies
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((therapy: any) => therapy.patientId === patient.id && therapy.status === 'active')
        .toArray();
    therapies.sort((left, right) => compareDatesDesc(left.startDate, right.startDate));

    const observations = await db.observations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((observation: any) => observation.patientId === patient.id)
        .toArray();
    observations.sort((left, right) => compareDatesDesc(left.observedAt, right.observedAt));

    const checkups = await db.checkups
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((checkup: any) => checkup.patientId === patient.id && checkup.status !== 'completed' && checkup.status !== 'cancelled')
        .toArray();
    checkups.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    const attachments = await db.attachments
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((attachment: any) => attachment.patientId === patient.id)
        .toArray();
    attachments.sort((left, right) => compareDatesDesc(left.createdAt, right.createdAt));

    const archiveSummaries = parsePatientDatedRecords<DocumentInsight>(patient.documentInsights)
        .sort((left, right) => compareDatesDesc(left.date, right.date))
        .map((insight) => {
            const fileName = compactText(insight.fileName, 80);
            const summary = compactText(insight.summary, DOCUMENT_SOURCE_SUMMARY_CHARS);
            if (!summary) return '';
            return fileName ? `${fileName}: ${summary}` : summary;
        })
        .filter(Boolean);

    const attachmentSummaries = attachments
        .filter((attachment) => attachment.summarySnapshot?.trim())
        .map((attachment) => {
            const fileName = compactText(attachment.name, 80);
            const summary = compactText(attachment.summarySnapshot, DOCUMENT_SOURCE_SUMMARY_CHARS);
            if (!summary) return '';
            return fileName ? `${fileName}: ${summary}` : summary;
        })
        .filter(Boolean);

    const limitations: string[] = [];
    const seenDocuments = new Set<string>();
    const uniqueDocumentSummaries = [...archiveSummaries, ...attachmentSummaries]
        .filter((line) => {
            const key = line.toLowerCase();
            if (seenDocuments.has(key)) return false;
            seenDocuments.add(key);
            return true;
        });

    const runtimeSettings = await getAIInsightRuntimeSettings({
        patientComplexityScore: estimateAIInsightComplexityScore({
            diagnoses: allDiagnoses.length,
            entries: activeEntries.length,
            documents: uniqueDocumentSummaries.length,
        }),
    });

    const documentLines: string[] = [];
    let documentContextChars = 0;
    let omittedDocumentCount = 0;

    for (const rawLine of uniqueDocumentSummaries) {
        const line = compactText(rawLine, runtimeSettings.maxDocumentSummaryChars);
        if (!line) continue;
        if (documentLines.length >= runtimeSettings.maxDocuments) {
            omittedDocumentCount += 1;
            continue;
        }

        const promptLine = `- ${line}`;
        if (documentLines.length > 0 && documentContextChars + promptLine.length > runtimeSettings.maxDocumentContextChars) {
            omittedDocumentCount += 1;
            continue;
        }

        documentLines.push(promptLine);
        documentContextChars += promptLine.length;
    }

    if (omittedDocumentCount > 0) {
        limitations.push(`Il contesto documentale AI e stato ridotto a ${documentLines.length} documenti per rispettare il budget configurato.`);
    }

    const patientNotes = typeof patient.notes === 'string' ? patient.notes.trim() : '';
    const allowNarrativeNotes = patientNotes.length > 0 && !isNarrativeNoteContaminated(patientNotes);
    if (patientNotes.length > 0 && !allowNarrativeNotes) {
        limitations.push('Le note narrative della scheda sono state escluse dal contesto AI per possibili residui di output automatico.');
    }

    const profileLines = [
        `- Anagrafica clinica: ${patient.lastName} ${patient.firstName}, eta ${age}, CF ${patient.taxCode || 'N/A'}.`,
        `- ADI: ${patient.isAdi ? 'si' : 'no'}.`,
        patient.monitoringProfile ? `- Profilo monitoraggio: ${patient.monitoringProfile}.` : '',
        allowNarrativeNotes ? `- Note scheda: ${compactText(patientNotes, 220)}` : '',
    ].filter(Boolean);

    const diagnosisLines = diagnoses
        .map((diagnosis) => {
            const when = formatDate(diagnosis.date);
            const detail = `${diagnosis.system || 'ICD'} ${diagnosis.code}: ${compactText(diagnosis.description, 140)}`;
            return `- ${when ? `${detail} (${when})` : detail}`;
        });

    const therapyLines = therapies
        .slice(0, MAX_THERAPIES)
        .map((therapy) => {
            const indication = therapy.diagnosisName ? `; indicazione ${compactText(therapy.diagnosisName, 80)}` : '';
            return `- ${compactText(therapy.drugName, 80)} ${compactText(therapy.dosage, 60)}${indication}`;
        });

    const observationLines = observations
        .slice(0, MAX_OBSERVATIONS)
        .map((observation) => {
            const note = observation.notes ? `; note ${compactText(observation.notes, 90)}` : '';
            return `- ${compactText(observation.display, 90)} (${observation.code}) = ${observation.value} ${observation.unitCode} [${formatDate(observation.observedAt)}]${note}`;
        });

    const checkupLines = checkups
        .slice(0, MAX_CHECKUPS)
        .map((checkup) => {
            const note = checkup.notes ? `; note ${compactText(checkup.notes, 90)}` : '';
            return `- ${formatDate(checkup.date)}: ${compactText(checkup.title, 120)}${note}`;
        });

    const diaryLines = entries
        .map((entry) => `- [${formatDate(entry.date)}] ${String(entry.type).toUpperCase()}: ${compactText(entry.content, 220)}`);

    let nextIndex = 1;
    const profileRefs = createSourceRefs('Profilo strutturato', profileLines, nextIndex);
    nextIndex = profileRefs.nextIndex;
    const diagnosisRefs = createSourceRefs('Diagnosi codificate', diagnosisLines, nextIndex);
    nextIndex = diagnosisRefs.nextIndex;
    const therapyRefs = createSourceRefs('Terapie attive', therapyLines, nextIndex);
    nextIndex = therapyRefs.nextIndex;
    const observationRefs = createSourceRefs('Osservazioni recenti', observationLines, nextIndex);
    nextIndex = observationRefs.nextIndex;
    const checkupRefs = createSourceRefs('Controlli pendenti', checkupLines, nextIndex);
    nextIndex = checkupRefs.nextIndex;
    const diaryRefs = createSourceRefs('Diario clinico recente', diaryLines, nextIndex);
    nextIndex = diaryRefs.nextIndex;
    const documentRefs = createSourceRefs('Documenti recenti', documentLines, nextIndex);

    const sourceRefs = [
        ...profileRefs.refs,
        ...diagnosisRefs.refs,
        ...therapyRefs.refs,
        ...observationRefs.refs,
        ...checkupRefs.refs,
        ...diaryRefs.refs,
        ...documentRefs.refs,
    ];

    const prompt = [
        `--- CONTESTO PAZIENTE (ID: ${patient.id}) ---`,
        `DATI BASE: ${patient.lastName} ${patient.firstName} | Eta: ${age} | CF: ${patient.taxCode || 'N/A'}`,
        '',
        'REGOLE HARD:',
        '- Ogni claim principale deve terminare con uno o piu riferimenti [Sx] presenti nel contesto oppure [DATI-INCOMPLETI].',
        '- Non usare mai note narrative contaminate da precedenti output AI come fonte clinica.',
        '- Non inventare fonti, nomi di persona o dettagli non presenti.',
        '',
        '[PROFILO STRUTTURATO]',
        renderSourceRefs(profileRefs.refs) || 'Nessuna informazione strutturata disponibile.',
        '',
        '[DIAGNOSI CODIFICATE]',
        renderSourceRefs(diagnosisRefs.refs) || 'Nessuna diagnosi codificata registrata.',
        '',
        '[TERAPIE ATTIVE]',
        renderSourceRefs(therapyRefs.refs) || 'Nessuna terapia attiva registrata.',
        '',
        '[OSSERVAZIONI RECENTI]',
        renderSourceRefs(observationRefs.refs) || 'Nessuna osservazione recente.',
        '',
        '[CONTROLLI PENDENTI]',
        renderSourceRefs(checkupRefs.refs) || 'Nessun controllo pendente.',
        '',
        '[DIARIO CLINICO RECENTE]',
        renderSourceRefs(diaryRefs.refs) || 'Nessuna nota recente.',
        '',
        '[DOCUMENTI RECENTI]',
        renderSourceRefs(documentRefs.refs) || 'Nessun documento analizzato.',
        '--- FINE CONTESTO ---',
        'Usa solo queste informazioni per rispondere alla richiesta dell\'utente.',
    ].join('\n');

    return {
        prompt,
        sourceRefs,
        limitations,
        outputMaxTokens: runtimeSettings.outputMaxTokens,
        patientName: {
            firstName: patient.firstName,
            lastName: patient.lastName,
        },
    };
}

/**
 * Builds an assistant-safe text context for a specific patient ID.
 */
export async function buildPatientContext(patientId: string): Promise<string> {
    const context = await buildPatientInsightContext(patientId);
    return context.prompt;
}

/**
 * Smart Search: Tries to find a patient mentioned in the text.
 * Returns the generated context if a UNIQUE match is found.
 */
export async function findAndBuildSmartContext(text: string): Promise<PatientContext> {
    const allPatients = await db.patients.toArray();
    const cleanText = text.toLowerCase();

    const potentialMatches = allPatients.filter((patient) => {
        const firstName = patient.firstName.toLowerCase();
        const lastName = patient.lastName.toLowerCase();
        return cleanText.includes(lastName) || cleanText.includes(`${firstName} ${lastName}`) || cleanText.includes(`${lastName} ${firstName}`);
    });

    if (potentialMatches.length === 1) {
        const context = await buildPatientContext(potentialMatches[0].id!);
        return {
            found: true,
            summary: context,
            patientName: `${potentialMatches[0].lastName} ${potentialMatches[0].firstName}`,
        };
    }

    return { found: false, summary: '' };
}
