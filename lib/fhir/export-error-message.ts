import type { ToastOptions } from '@/components/ui/toast-provider';
import type { FhirClinicalEntryInput } from './types';
import type { FhirExportPrecheckError } from './export-precheck';

export function buildFhirExportBlockingToast(
    error: FhirExportPrecheckError,
    entry: FhirClinicalEntryInput | undefined,
): ToastOptions {
    if (error.category === 'therapy') {
        return { tone: 'error', title: 'Esportazione bloccata', description: 'Una terapia ha un periodo da verificare.' };
    }
    if (error.category !== 'scale') {
        const description = error.category === 'diagnosis'
            ? 'Una diagnosi è priva di una data di registrazione valida.'
            : error.code === 'INVALID_ENCOUNTER_PAIR'
                ? 'Il luogo registrato è assente o incompatibile con il tipo di incontro.'
                : 'Un incontro del diario è privo di una data valida.';
        return { tone: 'error', title: 'Esportazione bloccata', description };
    }
    const date = entry ? new Date(entry.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'data non disponibile';
    const title = entry?.metadata?.title;
    const hasTitle = typeof title === 'string' && title.trim() !== '';
    return {
        tone: 'error',
        title: 'Esportazione bloccata',
        description: hasTitle && error.code !== 'INVALID_SCALE_TITLE'
            ? `La scala «${title}» del ${date} non ha un punteggio intero valido. Correggila o eliminala, poi riprova.`
            : `La scala del ${date} non ha un titolo valido. Correggila o eliminala, poi riprova.`,
    };
}
