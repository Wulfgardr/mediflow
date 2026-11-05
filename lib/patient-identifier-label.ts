/** Nome breve dell'identificativo del paziente da mostrare accanto al valore:
    un codice senza etichetta non dice che cosa sia. STP ed ENI si riconoscono dal
    prefisso seguito da 13 cifre: un codice fiscale ordinario può iniziare con
    le stesse lettere (cognome «Stoppa» → STP…), ma ha lettere nelle posizioni
    del nome e del mese. Ogni altro codice resta «CF». Stessa regola di
    `PairedPatientsWorkspaceSupport.identifierLabel` nell'app Apple. */
export function patientIdentifierLabel(value: string | null | undefined): string {
    const normalized = (value ?? '').trim().toUpperCase();
    const temporary = /^(STP|ENI)\d{13}$/.exec(normalized);
    if (temporary) return temporary[1];
    return 'CF';
}
