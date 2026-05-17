/* @Codex */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

type SourceKind = 'icloud-eventkit' | 'zimbra-carbonio';

type SourceDefinition = {
    kind: SourceKind;
    relativePath: string;
    label: string;
};

type RawEvent = Record<string, unknown>;

export type ClinicalAgendaReviewState = 'candidate';

export interface ClinicalAgendaCandidate {
    id: string;
    sourceKind: SourceKind;
    sourceLabel: string;
    sourceFile: string;
    rawSourceId?: string;
    title: string;
    startIso: string;
    endIso?: string;
    location?: string;
    calendarTitle?: string;
    score: number;
    reasons: string[];
    matchedSignals: string[];
    reviewState: ClinicalAgendaReviewState;
}

export interface ClinicalAgendaSourceStatus {
    sourceKind: SourceKind;
    sourceLabel: string;
    sourceFile: string;
    exists: boolean;
    parsed: number;
    candidates: number;
    ignored: number;
    invalid: number;
    status: 'ready' | 'missing' | 'unreadable';
}

export interface ClinicalAgendaBridgeResult {
    version: 'clinicalAgendaCandidate.v1';
    generatedAtIso: string;
    enabled: boolean;
    configuredByEnv: boolean;
    window: {
        fromIso: string;
        toIso: string;
    };
    stats: {
        parsed: number;
        candidates: number;
        ignored: number;
        invalid: number;
    };
    sourceStatuses: ClinicalAgendaSourceStatus[];
    candidates: ClinicalAgendaCandidate[];
}

export interface LoadClinicalAgendaOptions {
    assistantDir?: string;
    now?: Date;
    pastDays?: number;
    futureDays?: number;
    limit?: number;
}

type Classification = {
    accepted: boolean;
    score: number;
    reasons: string[];
    matchedSignals: string[];
};

const SOURCES: SourceDefinition[] = [
    {
        kind: 'icloud-eventkit',
        relativePath: 'data/icloud_calendar_events.jsonl',
        label: 'iCloud EventKit',
    },
    {
        kind: 'zimbra-carbonio',
        relativePath: 'data/calendar_events.jsonl',
        label: 'Zimbra/Carbonio',
    },
];

const SIGNALS: { tokens: string[]; weight: number; reason: string; anchor?: boolean }[] = [
    { tokens: ['fbf', 'fatebenefratelli'], weight: 4, reason: 'FBF/Fatebenefratelli', anchor: true },
    { tokens: ['asst', 'ospedale', 'presidio', 'sacco'], weight: 3, reason: 'contesto ospedaliero/ASST', anchor: true },
    { tokens: ['ambulatorio', 'ambulatoriale', 'domiciliare'], weight: 3, reason: 'attivita clinica programmata', anchor: true },
    { tokens: ['paziente', 'visita', 'controllo', 'follow up', 'follow-up'], weight: 2, reason: 'appuntamento paziente', anchor: true },
    { tokens: ['cml', 'commissione', 'medicina legale'], weight: 3, reason: 'commissione o medicina legale', anchor: true },
    { tokens: ['distretto', 'equipe', 'riunione casi', 'case review'], weight: 2, reason: 'coordinamento clinico territoriale', anchor: true },
    { tokens: ['siss', 'fse', 'prescrittivo', 'esenzione', 'pai', 'sgdt', 'cot'], weight: 2, reason: 'flusso sanitario regionale', anchor: true },
    { tokens: ['mmg', 'medico', 'terapia', 'referto', 'dimissione', 'prelievo'], weight: 1, reason: 'lessico sanitario' },
    { tokens: ['turno', 'seduta', 'guardia'], weight: 1, reason: 'turno o seduta clinica' },
];

const EXCLUSIONS: { tokens: string[]; weight: number; reason: string }[] = [
    { tokens: ['compleanno', 'birthday'], weight: 4, reason: 'evento personale' },
    { tokens: ['vacanza', 'ferie', 'holiday', 'viaggio'], weight: 3, reason: 'assenza o viaggio' },
    { tokens: ['spesa', 'palestra', 'cena', 'pranzo', 'famiglia', 'personale', 'privato'], weight: 3, reason: 'impegno non clinico' },
];

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseDate(value: unknown): Date | null {
    const raw = asString(value);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function hashCandidate(parts: string[]): string {
    return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

function resolveAssistantDir(assistantDir?: string): { dir: string; configuredByEnv: boolean } {
    if (assistantDir?.trim()) {
        return { dir: assistantDir.trim(), configuredByEnv: true };
    }

    const configured = process.env.MEDIFLOW_ZIMBRA_ASSISTANT_DIR?.trim();
    if (configured) return { dir: configured, configuredByEnv: true };

    return {
        dir: path.join(homedir(), 'Documents', 'zimbra-mail-assistant'),
        configuredByEnv: false,
    };
}

function buildWindow(now: Date, pastDays: number, futureDays: number) {
    const from = new Date(now);
    from.setDate(from.getDate() - pastDays);
    from.setHours(0, 0, 0, 0);

    const to = new Date(now);
    to.setDate(to.getDate() + futureDays);
    to.setHours(23, 59, 59, 999);

    return { from, to };
}

function isInsideWindow(start: Date, from: Date, to: Date): boolean {
    const value = start.getTime();
    return value >= from.getTime() && value <= to.getTime();
}

function classifyEvent(searchText: string): Classification {
    const normalized = normalizeText(searchText);
    const reasons: string[] = [];
    const matchedSignals: string[] = [];
    let score = 0;
    let hasAnchor = false;

    for (const signal of SIGNALS) {
        const matched = signal.tokens.filter((token) => normalized.includes(normalizeText(token)));
        if (matched.length === 0) continue;
        score += signal.weight;
        if (signal.anchor) hasAnchor = true;
        reasons.push(signal.reason);
        matchedSignals.push(...matched);
    }

    for (const exclusion of EXCLUSIONS) {
        const matched = exclusion.tokens.filter((token) => normalized.includes(normalizeText(token)));
        if (matched.length === 0) continue;
        score -= exclusion.weight;
        reasons.push(`esclusione: ${exclusion.reason}`);
    }

    const accepted = score >= 3 && hasAnchor;

    return {
        accepted,
        score,
        reasons: Array.from(new Set(reasons)),
        matchedSignals: Array.from(new Set(matchedSignals)),
    };
}

function normalizeRawEvent(raw: RawEvent, source: SourceDefinition): ClinicalAgendaCandidate | null {
    const title = asString(raw.title) ?? asString(raw.subject);
    const start = parseDate(raw.start_iso);
    if (!title || !start) return null;

    const end = parseDate(raw.end_iso);
    const location = asString(raw.location);
    const calendarTitle = asString(raw.calendar_title) ?? asString(raw.calendar_id);
    const sourceTitle = asString(raw.source_title);
    const rawSourceId = asString(raw.id);
    const searchText = [
        title,
        location,
        calendarTitle,
        sourceTitle,
    ].filter(Boolean).join(' · ');
    const classification = classifyEvent(searchText);

    if (!classification.accepted) return null;

    return {
        id: hashCandidate([
            source.kind,
            rawSourceId ?? '',
            title,
            start.toISOString(),
        ]),
        sourceKind: source.kind,
        sourceLabel: source.label,
        sourceFile: source.relativePath,
        rawSourceId,
        title,
        startIso: start.toISOString(),
        endIso: end?.toISOString(),
        location,
        calendarTitle,
        score: classification.score,
        reasons: classification.reasons,
        matchedSignals: classification.matchedSignals,
        reviewState: 'candidate',
    };
}

async function readJsonl(filePath: string): Promise<{ rows: RawEvent[]; invalid: number }> {
    const content = await readFile(filePath, 'utf8');
    const rows: RawEvent[] = [];
    let invalid = 0;

    for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                rows.push(parsed as RawEvent);
            } else {
                invalid += 1;
            }
        } catch {
            invalid += 1;
        }
    }

    return { rows, invalid };
}

function emptyResult(options: {
    now: Date;
    configuredByEnv: boolean;
    from: Date;
    to: Date;
    sourceStatuses: ClinicalAgendaSourceStatus[];
}): ClinicalAgendaBridgeResult {
    return {
        version: 'clinicalAgendaCandidate.v1',
        generatedAtIso: options.now.toISOString(),
        enabled: false,
        configuredByEnv: options.configuredByEnv,
        window: {
            fromIso: options.from.toISOString(),
            toIso: options.to.toISOString(),
        },
        stats: { parsed: 0, candidates: 0, ignored: 0, invalid: 0 },
        sourceStatuses: options.sourceStatuses,
        candidates: [],
    };
}

export async function loadClinicalAgendaCandidates(
    options: LoadClinicalAgendaOptions = {},
): Promise<ClinicalAgendaBridgeResult> {
    const now = options.now ?? new Date();
    const pastDays = Math.max(0, Math.min(options.pastDays ?? 1, 30));
    const futureDays = Math.max(1, Math.min(options.futureDays ?? 30, 180));
    const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
    const { dir, configuredByEnv } = resolveAssistantDir(options.assistantDir);
    const { from, to } = buildWindow(now, pastDays, futureDays);

    const sourceStatuses: ClinicalAgendaSourceStatus[] = [];
    const candidates: ClinicalAgendaCandidate[] = [];
    let parsed = 0;
    let ignored = 0;
    let invalid = 0;

    try {
        const dirStatus = await stat(dir);
        if (!dirStatus.isDirectory()) {
            return emptyResult({ now, configuredByEnv, from, to, sourceStatuses });
        }
    } catch {
        return emptyResult({ now, configuredByEnv, from, to, sourceStatuses });
    }

    for (const source of SOURCES) {
        const sourcePath = path.join(/*turbopackIgnore: true*/ dir, source.relativePath);
        const status: ClinicalAgendaSourceStatus = {
            sourceKind: source.kind,
            sourceLabel: source.label,
            sourceFile: source.relativePath,
            exists: false,
            parsed: 0,
            candidates: 0,
            ignored: 0,
            invalid: 0,
            status: 'missing',
        };

        try {
            const fileStatus = await stat(sourcePath);
            if (!fileStatus.isFile()) {
                sourceStatuses.push(status);
                continue;
            }
            status.exists = true;
        } catch {
            sourceStatuses.push(status);
            continue;
        }

        try {
            const { rows, invalid: invalidRows } = await readJsonl(sourcePath);
            status.status = 'ready';
            status.parsed = rows.length;
            status.invalid = invalidRows;
            parsed += rows.length;
            invalid += invalidRows;

            for (const row of rows) {
                const start = parseDate(row.start_iso);
                if (!start || !isInsideWindow(start, from, to)) {
                    status.ignored += 1;
                    ignored += 1;
                    continue;
                }

                const candidate = normalizeRawEvent(row, source);
                if (!candidate) {
                    status.ignored += 1;
                    ignored += 1;
                    continue;
                }

                status.candidates += 1;
                candidates.push(candidate);
            }
        } catch {
            status.status = 'unreadable';
        }

        sourceStatuses.push(status);
    }

    const deduped = Array.from(
        new Map(candidates.map((candidate) => [candidate.id, candidate])).values(),
    ).sort((left, right) => {
        const timeDelta = new Date(left.startIso).getTime() - new Date(right.startIso).getTime();
        if (timeDelta !== 0) return timeDelta;
        return right.score - left.score;
    });

    return {
        version: 'clinicalAgendaCandidate.v1',
        generatedAtIso: now.toISOString(),
        enabled: sourceStatuses.some((source) => source.status === 'ready'),
        configuredByEnv,
        window: {
            fromIso: from.toISOString(),
            toIso: to.toISOString(),
        },
        stats: {
            parsed,
            candidates: deduped.length,
            ignored,
            invalid,
        },
        sourceStatuses,
        candidates: deduped.slice(0, limit),
    };
}
