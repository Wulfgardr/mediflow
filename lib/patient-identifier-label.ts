/** Nome breve dell'identificativo del paziente da mostrare accanto al valore:
    un codice senza etichetta non dice che cosa sia. STP ed ENI si riconoscono dal
    prefisso; ogni altro codice resta «CF». Stessa regola di
    `PairedPatientsWorkspaceSupport.identifierLabel` nell'app Apple. */
export function patientIdentifierLabel(value: string | null | undefined): string {
    const normalized = (value ?? '').trim().toUpperCase();
    if (normalized.startsWith('STP')) return 'STP';
    if (normalized.startsWith('ENI')) return 'ENI';
    return 'CF';
}
