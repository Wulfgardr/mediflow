/**
 * Glossario unico italiano per le etichette dello stack intelligente.
 *
 * Prima di questo modulo le superfici AI mostravano valori inglesi crudi
 * (high/medium, green/red, catalog/none) in modo incoerente tra loro. Centralizza
 * la traduzione cosi la scheda parla una sola lingua. Le funzioni sono tolleranti:
 * su valore sconosciuto restituiscono l'input pulito invece di rompere la UI.
 */

export type AiConfidence = 'high' | 'medium' | 'low';
export type AiQualityLevel = 'green' | 'yellow' | 'red';
export type AiMatchType = 'catalog' | 'manual' | 'none';

function fallbackLabel(value: string | undefined | null): string {
    return (value ?? '').toString().trim();
}

/** Confidenza di un suggerimento AI: high | medium | low (| blocked). */
export function confidenceLabel(value: string | undefined | null): string {
    switch (fallbackLabel(value).toLowerCase()) {
        case 'high': return 'Alta';
        case 'medium': return 'Media';
        case 'low': return 'Bassa';
        case 'blocked': return 'bloccata';
        default: return fallbackLabel(value);
    }
}

/** Livello di qualita di un documento analizzato: green | yellow | red. */
export function qualityLabel(value: string | undefined | null): string {
    switch (fallbackLabel(value).toLowerCase()) {
        case 'green': return 'Buona';
        case 'yellow': return 'Da verificare';
        case 'red': return 'Critica';
        default: return fallbackLabel(value);
    }
}

/** Tipo di aggancio di una terapia al catalogo AIFA: catalog | manual | none. */
export function matchTypeLabel(value: string | undefined | null): string {
    switch (fallbackLabel(value).toLowerCase()) {
        case 'catalog': return 'match AIFA';
        case 'manual': return 'manuale';
        case 'none': return 'senza match';
        default: return fallbackLabel(value);
    }
}
