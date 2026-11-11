/** Frase a schermo per l'esito terminale della sintesi; il codice resta nei dettagli. Modulo puro: lo usano il componente e l'orchestratore. */
export function documentSynthesisFailureHeadline(code: string | null): string {
    if (code === 'unsupported_local_extraction') return 'Testo locale non disponibile. È necessaria la revisione manuale del documento.';
    if (code === 'model_response_invalid') return 'La risposta del modello non era valida. Riprova.';
    if (code === 'citation_not_literal') return 'Il modello non ha citato il documento parola per parola. Riprova.';
    return 'Sintesi non disponibile. La cartella rimane invariata.';
}
