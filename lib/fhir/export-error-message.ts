import type { ToastOptions } from '@/components/ui/toast-provider';
import type { FhirClinicalEntryInput } from './types';
import type { FhirExportPrecheckError } from './export-precheck';

export function buildFhirExportBlockingToast(
    error: FhirExportPrecheckError,
    entry: FhirClinicalEntryInput | undefined,
): ToastOptions {
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
