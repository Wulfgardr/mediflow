/**
 * View model unico dell'insight paziente.
 *
 * Prima esistevano tre letture indipendenti dello stesso artefatto aiSummary
 * (parser markdown nel service, coerceInsightToReadable nel pannello, estrazione
 * nel cockpit): una modifica del formato andava replicata ovunque e la review
 * queue poteva dire "disponibile" su un envelope JSON che il pannello marchiava
 * "illeggibile". Questo modulo centralizza la classificazione di leggibilita cosi
 * pannello e review queue concordano.
 */

import { parsePatientInsight } from '@/lib/ai-summary-service';
import { splitInsightDiagnostics } from '@/lib/patient-insight';
import { declaresModernEnvelope, extractJsonObject, isEnvelopeUsable, parsePatientInsightExtractionResponse } from '@/lib/ai-task-contracts';

/* @Codex: shim di parsing sul rilevatore canonico ricorsivo e case-insensitive */
function declaresTaskEnvelope(rawJson: string | null): boolean {
    if (!rawJson) return false;
    try {
        return declaresModernEnvelope(JSON.parse(rawJson));
    } catch {
        return false;
    }
}

/* @Codex: rilevazione fail-closed dell'envelope anche quando il JSON dichiarato non e parseabile */
function contentDeclaresEnvelope(content: string): boolean {
    const rawJson = extractJsonObject(content)?.rawJson ?? null;
    if (rawJson && declaresTaskEnvelope(rawJson)) return true;
    return /"(schemaversion|task)"\s*:/i.test(rawJson ?? content);
}

export type ReadableInsight =
    | {
        kind: 'structured';
        summary: string;
        alerts: string[];
        nextSteps: string[];
        gaps: string[];
        sourcesMarkdown: string;
        limitsMarkdown: string;
    }
    | {
        kind: 'markdown';
        markdown: string;
        sourcesMarkdown: string;
        limitsMarkdown: string;
    }
    | {
        kind: 'unreadable';
        reason: 'json-envelope' | 'empty';
    };

const ENVELOPE_HINT_PATTERN = /["']?(?:choices|message|content|role|delta|object|schemaVersion|finish_reason)["']?\s*:/i;

function looksLikeJsonOrEnvelope(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
    return ENVELOPE_HINT_PATTERN.test(trimmed.slice(0, 400));
}

function deepFindReadableString(node: unknown, keys: string[], depth = 0): string | null {
    if (depth > 6) return null;
    if (typeof node === 'string') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = deepFindReadableString(item, keys, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().length > 16) return value;
        }
        for (const value of Object.values(record)) {
            const found = deepFindReadableString(value, keys, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

function asStructured(
    summary: string,
    alerts: string[],
    nextSteps: string[],
    gaps: string[],
    diagnostics: { sourcesMarkdown: string; limitsMarkdown: string },
): ReadableInsight {
    return {
        kind: 'structured',
        summary: summary.replace(/\n+/g, ' ').trim(),
        alerts: alerts.filter((item) => item && item.trim().length > 0),
        nextSteps: nextSteps.filter((item) => item && item.trim().length > 0),
        gaps: gaps.filter((item) => item && item.trim().length > 0),
        sourcesMarkdown: diagnostics.sourcesMarkdown,
        limitsMarkdown: diagnostics.limitsMarkdown,
    };
}

export function coerceInsightToReadable(rawSummary: string): ReadableInsight {
    const content = (rawSummary || '').trim();
    if (!content) return { kind: 'unreadable', reason: 'empty' };

    const looksJson = looksLikeJsonOrEnvelope(content);
    const fromMarkdown = parsePatientInsight(content);
    const diagnostics = splitInsightDiagnostics(content);
    const hasStructured = Boolean(
        fromMarkdown.summary ||
        fromMarkdown.alerts.length ||
        fromMarkdown.nextSteps.length ||
        fromMarkdown.gaps.length,
    );

    // @Codex: un contenuto JSON-like passa sempre prima dal gate contrattuale
    if (hasStructured && !looksJson) {
        return asStructured(
            fromMarkdown.summary,
            fromMarkdown.alerts,
            fromMarkdown.nextSteps,
            fromMarkdown.gaps,
            diagnostics,
        );
    }

    if (!looksJson) {
        const mainMarkdown = diagnostics.mainMarkdown || fromMarkdown.fallbackMarkdown;
        if (mainMarkdown.trim().length === 0) {
            return { kind: 'unreadable', reason: 'empty' };
        }
        return {
            kind: 'markdown',
            markdown: mainMarkdown,
            sourcesMarkdown: diagnostics.sourcesMarkdown,
            limitsMarkdown: diagnostics.limitsMarkdown,
        };
    }

    try {
        const extraction = parsePatientInsightExtractionResponse(content);
        // @Codex
        if (isEnvelopeUsable(extraction)) {
            const data = extraction.value.data;
            const hasExtraction = Boolean(
                data.currentState.length ||
                data.alerts.length ||
                data.nextSteps.length ||
                data.gaps.length,
            );

            if (hasExtraction) {
                return asStructured(
                    data.currentState.join(' '),
                    data.alerts,
                    data.nextSteps,
                    data.gaps,
                    diagnostics,
                );
            }

            if (extraction.value.summary) {
                return asStructured(extraction.value.summary, [], [], [], diagnostics);
            }
        } else if (declaresTaskEnvelope(extraction.rawJson)) {
            // @Codex: solo un envelope dichiarato e non valido e illeggibile; i wrapper storici proseguono nel recupero
            return { kind: 'unreadable', reason: 'json-envelope' };
        }
    } catch {
        // fall through to free-text recovery
    }

    try {
        const parsed = JSON.parse(content) as unknown;
        const inner = deepFindReadableString(parsed, ['content', 'text', 'summary', 'output', 'value', 'markdown']);
        if (inner) {
            // @Codex: un envelope dichiarato dentro un wrapper segue le stesse regole del livello esterno
            const innerRaw = extractJsonObject(inner);
            if (innerRaw && declaresTaskEnvelope(innerRaw.rawJson)) {
                const innerExtraction = parsePatientInsightExtractionResponse(inner);
                if (!isEnvelopeUsable(innerExtraction)) {
                    return { kind: 'unreadable', reason: 'json-envelope' };
                }
                const innerData = innerExtraction.value.data;
                const innerDiagnostics = splitInsightDiagnostics(inner);
                const innerHasExtraction = Boolean(
                    innerData.currentState.length ||
                    innerData.alerts.length ||
                    innerData.nextSteps.length ||
                    innerData.gaps.length,
                );
                if (innerHasExtraction) {
                    return asStructured(
                        innerData.currentState.join(' '),
                        innerData.alerts,
                        innerData.nextSteps,
                        innerData.gaps,
                        innerDiagnostics,
                    );
                }
                if (innerExtraction.value.summary) {
                    return asStructured(innerExtraction.value.summary, [], [], [], innerDiagnostics);
                }
                return { kind: 'unreadable', reason: 'empty' };
            }
            const innerStructured = parsePatientInsight(inner);
            const innerDiagnostics = splitInsightDiagnostics(inner);
            const innerHas = Boolean(
                innerStructured.summary ||
                innerStructured.alerts.length ||
                innerStructured.nextSteps.length ||
                innerStructured.gaps.length,
            );
            if (innerHas) {
                return asStructured(
                    innerStructured.summary,
                    innerStructured.alerts,
                    innerStructured.nextSteps,
                    innerStructured.gaps,
                    innerDiagnostics,
                );
            }
            const innerMarkdown = innerDiagnostics.mainMarkdown || innerStructured.fallbackMarkdown;
            if (innerMarkdown.trim().length > 0) {
                return {
                    kind: 'markdown',
                    markdown: innerMarkdown,
                    sourcesMarkdown: innerDiagnostics.sourcesMarkdown,
                    limitsMarkdown: innerDiagnostics.limitsMarkdown,
                };
            }
        }
    } catch {
        // payload was JSON-like but not valid JSON
    }

    // @Codex: contenuto misto gia strutturato senza envelope dichiarato resta leggibile
    if (hasStructured && !contentDeclaresEnvelope(content)) {
        return asStructured(
            fromMarkdown.summary,
            fromMarkdown.alerts,
            fromMarkdown.nextSteps,
            fromMarkdown.gaps,
            diagnostics,
        );
    }
    return { kind: 'unreadable', reason: 'json-envelope' };
}

export type InsightReadability = 'ready' | 'unreadable' | 'absent';

/**
 * Stato di leggibilita usato sia dal pannello sia dalla review queue, cosi le due
 * superfici non si contraddicono (es. queue "disponibile" ma pannello "illeggibile").
 */
export function classifyInsightReadability(rawSummary: string | undefined | null): InsightReadability {
    if (!rawSummary || !rawSummary.trim()) return 'absent';
    const readable = coerceInsightToReadable(rawSummary);
    if (readable.kind === 'unreadable') {
        return readable.reason === 'empty' ? 'absent' : 'unreadable';
    }
    return 'ready';
}
