/* @Codex */
import { detectSuspiciousPersonNames } from './patient-data-guardrails';

/* @Codex */
export const CLAIM_SUPPORT_FALLBACK = 'DATI-INCOMPLETI';

const SOURCES_TITLE = 'Fonti usate per i claim';
const LIMITS_TITLE = 'Limiti noti';
const CLAIM_SECTIONS = new Set([
    'Quadro attuale',
    'Riassunto clinico',
    'Attenzioni',
    'Punti di attenzione',
    'Prossimi passi',
    'Prossima mossa',
    'Gap da chiarire',
]);

export interface PatientInsightSourceRefLike {
    id: string;
    label: string;
}

interface FinalizePatientInsightOptions {
    content: string;
    sourceRefs: PatientInsightSourceRefLike[];
    limitations?: string[];
    patientName?: {
        firstName: string;
        lastName: string;
    };
}

export interface PatientInsightDiagnostics {
    mainMarkdown: string;
    sourcesMarkdown: string;
    limitsMarkdown: string;
}

function stripModelArtifacts(content: string): string {
    return content
        .replace(/<unused94>[\s\S]*?(<unused95>|$)/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^Plan:\s*/gim, '')
        .replace(/\r/g, '')
        .trim();
}

export function stripCitationMarkers(value: string): string {
    return value.replace(/\s*\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function sanitizeInsightMarkdown(content: string): string {
    const clean = stripModelArtifacts(content);
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const rawLine of clean.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        const normalized = stripCitationMarkers(line).toLowerCase();

        if (!line.trim()) {
            if (lines[lines.length - 1] !== '') lines.push('');
            continue;
        }

        const isStructured = /^\*\*.+\*\*:?.*$/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
        if (isStructured && seen.has(normalized)) continue;
        if (isStructured) seen.add(normalized);
        lines.push(line);
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitInsightDiagnostics(content: string): PatientInsightDiagnostics {
    const sanitized = sanitizeInsightMarkdown(content);
    const sourcesMarker = `**${SOURCES_TITLE}:**`;
    const limitsMarker = `**${LIMITS_TITLE}:**`;
    const sourcesIndex = sanitized.indexOf(sourcesMarker);
    const limitsIndex = sanitized.indexOf(limitsMarker);
    const mainEnd = sourcesIndex >= 0 ? sourcesIndex : limitsIndex >= 0 ? limitsIndex : sanitized.length;

    return {
        mainMarkdown: sanitized.slice(0, mainEnd).trim(),
        sourcesMarkdown: sourcesIndex >= 0 ? sanitized.slice(sourcesIndex, limitsIndex >= 0 ? limitsIndex : sanitized.length).trim() : '',
        limitsMarkdown: limitsIndex >= 0 ? sanitized.slice(limitsIndex).trim() : '',
    };
}

function extractHeader(line: string): { title: string; rest: string } | null {
    const match = line.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/);
    if (!match) return null;
    return { title: match[1].replace(/:$/, '').trim(), rest: match[2].trim() };
}

function extractCitationTokens(line: string): { ids: string[]; explicitFallback: boolean } {
    const groups = line.match(/\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/g) ?? [];
    const ids = new Set<string>();
    let explicitFallback = false;

    for (const group of groups) {
        for (const token of group.slice(1, -1).split(',').map((item) => item.trim())) {
            if (token === CLAIM_SUPPORT_FALLBACK) {
                explicitFallback = true;
                continue;
            }
            ids.add(token);
        }
    }

    return { ids: Array.from(ids), explicitFallback };
}

function renderListSection(title: string, items: string[]): string {
    if (items.length === 0) return '';
    return `**${title}:**\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function buildFallbackInsight(limitations: string[]): string {
    const limitItems = limitations.length > 0
        ? limitations
        : ['Supporto locale insufficiente o incoerente per un insight clinico affidabile.'];

    return [
        '**Quadro attuale:** Insight AI declassato per supporto insufficiente o incoerente nel contesto locale.',
        '',
        '**Attenzioni:**',
        '- Verificare diario clinico, documenti e codifiche direttamente nella cartella.',
        '',
        '**Prossimi passi:**',
        '- Rigenerare l’insight dopo aver corretto le narrative o aggiunto fonti strutturate.',
        '',
        renderListSection(LIMITS_TITLE, limitItems),
    ].filter(Boolean).join('\n');
}

export function finalizePatientInsight(options: FinalizePatientInsightOptions): string {
    const validIds = new Set(options.sourceRefs.map((ref) => ref.id));
    const refsById = new Map(options.sourceRefs.map((ref) => [ref.id, ref] as const));
    const usedIds = new Set<string>();
    const diagnostics = new Set((options.limitations ?? []).filter(Boolean));
    const claimTexts: string[] = [];
    let unsupportedClaims = 0;
    let currentSection = '';

    const normalizedLines = sanitizeInsightMarkdown(options.content)
        .split('\n')
        .map((line) => {
            const header = extractHeader(line);
            if (header) {
                currentSection = header.title;
                if (!CLAIM_SECTIONS.has(currentSection) || !header.rest) return line;

                const baseLine = stripCitationMarkers(line);
                const { ids, explicitFallback } = extractCitationTokens(line);
                const validClaimIds = ids.filter((id) => validIds.has(id));
                const tokens = [...validClaimIds];

                for (const id of validClaimIds) usedIds.add(id);

                if (explicitFallback || validClaimIds.length === 0) {
                    tokens.push(CLAIM_SUPPORT_FALLBACK);
                    unsupportedClaims += 1;
                }

                claimTexts.push(stripCitationMarkers(header.rest));
                return `${stripCitationMarkers(baseLine)} [${tokens.join(', ')}]`;
            }

            if (!CLAIM_SECTIONS.has(currentSection)) return line;
            if (!/^[-*]\s+/.test(line) && !/^\d+\.\s+/.test(line)) return line;

            const { ids, explicitFallback } = extractCitationTokens(line);
            const validClaimIds = ids.filter((id) => validIds.has(id));
            const tokens = [...validClaimIds];

            for (const id of validClaimIds) usedIds.add(id);

            if (explicitFallback || validClaimIds.length === 0) {
                tokens.push(CLAIM_SUPPORT_FALLBACK);
                unsupportedClaims += 1;
            }

            claimTexts.push(stripCitationMarkers(line.replace(/^\s*(?:[-*]|\d+\.)\s*/, '')));
            return `${stripCitationMarkers(line)} [${tokens.join(', ')}]`;
        });

    const suspiciousNames = options.patientName
        ? detectSuspiciousPersonNames(claimTexts.join('\n'), options.patientName)
        : [];

    if (suspiciousNames.length > 0) {
        diagnostics.add(`Output AI declassato: compaiono riferimenti nominali non coerenti con il paziente (${suspiciousNames.join(', ')}).`);
    }

    if (unsupportedClaims > 0) {
        diagnostics.add('Alcuni claim non hanno supporto diretto sufficiente nel contesto locale.');
    }

    const shouldFallback = suspiciousNames.length > 0
        || (claimTexts.length >= 3 && unsupportedClaims / Math.max(claimTexts.length, 1) > 0.5);

    if (shouldFallback) {
        const fallbackMarkdown = buildFallbackInsight(Array.from(diagnostics));
        return [
            fallbackMarkdown,
            '',
            renderListSection(
                SOURCES_TITLE,
                [`[${CLAIM_SUPPORT_FALLBACK}] Claim senza supporto diretto sufficiente nel contesto locale.`],
            ),
        ].filter(Boolean).join('\n');
    }

    const sourceItems = Array.from(usedIds)
        .map((id) => refsById.get(id))
        .filter(Boolean)
        .map((ref) => `[${ref!.id}] ${ref!.label}`);

    if (unsupportedClaims > 0) {
        sourceItems.push(`[${CLAIM_SUPPORT_FALLBACK}] Claim senza supporto diretto sufficiente nel contesto locale.`);
    }

    const mainMarkdown = normalizedLines.join('\n').trim();
    const limitMarkdown = renderListSection(LIMITS_TITLE, Array.from(diagnostics));
    const sourcesMarkdown = renderListSection(SOURCES_TITLE, sourceItems);

    return [mainMarkdown, sourcesMarkdown, limitMarkdown].filter(Boolean).join('\n\n').trim();
}
