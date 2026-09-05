// @Codex MF085-002: presentation only. Never recalculate or enrich historical answers.
import { TINETTI_POMA28_ID, TINETTI_POMA28_INSTRUMENT } from './scales/tinetti-poma28-v1';

export const LEGACY_TINETTI_NOTICE = 'Tinetti storica o senza provenienza verificabile: punteggio e interpretazione riportati come registrati, non rivalutati con POMA-28 v1.';
export const SOURCE_BOUND_TINETTI_NOTICE = 'POMA-28 v1 · NHS FPS 006 V1 (2012). Resa italiana locale non validata; nessuna classificazione automatica del rischio.';

export function isSourceBoundTinetti(metadata: Record<string, unknown>): boolean {
    const instrument = metadata.instrument;
    return metadata.scaleId === TINETTI_POMA28_ID && instrument !== null && typeof instrument === 'object'
        && !Array.isArray(instrument) && Object.entries(TINETTI_POMA28_INSTRUMENT).every(
            ([key, value]) => Object.prototype.hasOwnProperty.call(instrument, key)
                && (instrument as Record<string, unknown>)[key] === value,
        );
}

export function scaleHistoryNotice(metadata: unknown, entryTitle = ''): string | null {
    const record = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown> : {};
    if (isSourceBoundTinetti(record)) return SOURCE_BOUND_TINETTI_NOTICE;
    const id = typeof record.scaleId === 'string' ? record.scaleId.toLowerCase() : '';
    const title = typeof record.title === 'string' && record.title.trim() ? record.title : entryTitle;
    return id.startsWith('tinetti') || title.toLowerCase().includes('tinetti')
        ? LEGACY_TINETTI_NOTICE : null;
}
