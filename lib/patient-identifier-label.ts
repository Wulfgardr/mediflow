/** Nome breve dell'identificativo del paziente da mostrare accanto al valore:
    un codice senza etichetta non dice che cosa sia. STP ed ENI si riconoscono dal
    prefisso seguito da 13 cifre: un codice fiscale ordinario può iniziare con
    le stesse lettere (cognome «Stoppa» → STP…), ma ha lettere nelle posizioni
    del nome e del mese. Ogni altro codice resta «CF». Stessa regola di
    `PairedPatientsWorkspaceSupport.identifierLabel` nell'app Apple. */
const TYPE_LABELS = { cf: 'CF', stp: 'STP', eni: 'ENI', passport: 'Documento', other: 'Identificativo' } as const;

export function patientIdentifierLabel(value: string | null | undefined, type?: string | null): string {
    /* Il tipo dichiarato vince: il prefisso serve solo per i record che non lo portano. */
    if (type && type in TYPE_LABELS) return TYPE_LABELS[type as keyof typeof TYPE_LABELS];
    const normalized = (value ?? '').trim().toUpperCase();
    const temporary = /^(STP|ENI)\d{13}$/.exec(normalized);
    if (temporary) return temporary[1];
    return 'CF';
}
