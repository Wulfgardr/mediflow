// MF085-002: presentation only. Never recalculate or enrich historical answers.
import { TINETTI_NONCLASSIFICATION, TINETTI_POMA28_ID, TINETTI_POMA28_INSTRUMENT } from './scales/tinetti-poma28-v1';

export const LEGACY_TINETTI_NOTICE = 'Tinetti storica o senza provenienza verificabile: punteggio e interpretazione riportati come registrati, non rivalutati con POMA-28 v1.';
const TINETTI_SOURCE = 'NHS FPS 006 V1 (2012)';
const TINETTI_TRANSLATION_NOTICE = 'Resa italiana locale non validata.';
export const SOURCE_BOUND_TINETTI_NOTICE = `POMA-28 v1 · ${TINETTI_SOURCE}. Resa italiana locale non validata; nessuna classificazione automatica del rischio.`;
export const TINETTI_CLINICAL_NOTICE = 'Il rischio di caduta richiede una valutazione clinica.';
const TINETTI_DISPLAY_TITLE = 'Tinetti POMA-28';

export function scaleDisplayTitle(scale: { id: string; title: string }): string {
    return scale.id === TINETTI_POMA28_ID ? TINETTI_DISPLAY_TITLE : scale.title;
}

export function tinettiScoreLabel(score: number): string {
    return `${score}/28`;
}

// Show the recorded policy identity, including unknown future versions, without
// treating it as validation or applying today's policy to historical answers.
export function scaleInterpretationVersionLabel(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const version = (metadata as Record<string, unknown>).interpretationVersion;
    return typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(version)
        ? `Versione interpretazione: ${version}` : null;
}

export function isSourceBoundTinetti(metadata: Record<string, unknown>): boolean {
    const instrument = metadata.instrument;
    return metadata.scaleId === TINETTI_POMA28_ID && instrument !== null && typeof instrument === 'object'
        && !Array.isArray(instrument) && Object.entries(TINETTI_POMA28_INSTRUMENT).every(
            ([key, value]) => Object.prototype.hasOwnProperty.call(instrument, key)
                && (instrument as Record<string, unknown>)[key] === value,
        );
}

function scaleRecord(metadata: unknown): Record<string, unknown> {
    return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown> : {};
}

function isTinetti(record: Record<string, unknown>, entryTitle: string): boolean {
    const id = typeof record.scaleId === 'string' ? record.scaleId.toLowerCase() : '';
    const title = typeof record.title === 'string' && record.title.trim() ? record.title : entryTitle;
    return id.startsWith('tinetti') || title.toLowerCase().includes('tinetti');
}

export function scaleHistoryNotice(metadata: unknown, entryTitle = ''): string | null {
    const record = scaleRecord(metadata);
    if (isSourceBoundTinetti(record)) return [SOURCE_BOUND_TINETTI_NOTICE, scaleInterpretationVersionLabel(record)]
        .filter(Boolean).join(' · ');
    return isTinetti(record, entryTitle) ? LEGACY_TINETTI_NOTICE : scaleInterpretationVersionLabel(record);
}

export function presentTinettiResult(metadata: unknown, entryTitle: string) {
    const record = scaleRecord(metadata);
    const { score, interpretation } = record;
    if (!isTinetti(record, entryTitle) || typeof score !== 'number' || !Number.isFinite(score)) return null;
    const sourceBound = isSourceBoundTinetti(record);
    return {
        title: sourceBound || record.scaleId === TINETTI_POMA28_ID ? TINETTI_DISPLAY_TITLE : entryTitle,
        score: sourceBound ? tinettiScoreLabel(score) : String(score),
        interpretation: sourceBound && interpretation === TINETTI_NONCLASSIFICATION
            ? TINETTI_CLINICAL_NOTICE : typeof interpretation === 'string' ? interpretation : null,
        notice: sourceBound ? TINETTI_TRANSLATION_NOTICE : 'Provenienza non verificabile. Punteggio e interpretazione come registrati.',
        source: sourceBound ? TINETTI_SOURCE : null,
        version: scaleInterpretationVersionLabel(record),
    };
}
