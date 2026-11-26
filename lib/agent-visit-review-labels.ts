export const agentReviewFieldLabels: Record<string, string> = { drugName: 'Farmaco', activePrinciple: 'Principio attivo', dosage: 'Posologia', status: 'Stato', startDate: 'Dal', endDate: 'Al', aic: 'AIC', atc: 'ATC', serviceName: 'Prestazione', items: 'Voci', category: 'Categoria', priority: 'Priorità', prescribedAt: 'Prescritta il', requestReference: 'Riferimento', clinicalQuestion: 'Quesito clinico', description: 'Descrizione', code: 'Codice', system: 'Sistema', date: 'Data', display: 'Esame', value: 'Valore', unit: 'Unità', unitCode: 'Codice unità', refText: 'Intervallo di riferimento', refLow: 'Limite inferiore', refHigh: 'Limite superiore', observedAt: 'Misurato il', subject: 'Soggetto', temporality: 'Periodo', certainty: 'Certezza' };

export const agentReviewFieldValues: Record<string, Record<string, string>> = {
    status: { active: 'In corso', suspended: 'Sospesa', completed: 'Conclusa', prescribed: 'Prescritta', booked: 'Prenotata', performed: 'Eseguita', report_received: 'Referto ricevuto', cancelled: 'Annullata' },
    category: { lab: 'Laboratorio', imaging: 'Imaging', visit: 'Visita', rehab: 'Riabilitazione', screening: 'Screening', procedure: 'Procedura', other: 'Altro' },
    priority: { routine: 'Routine', P: 'Programmata (P)', D: 'Differibile (D)', B: 'Breve (B)', U: 'Urgente (U)', unknown: 'Non indicata' },
};

const DATE_FIELDS = new Set(['startDate', 'endDate', 'prescribedAt', 'observedAt', 'date']);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/u;
const HASH_FILE = /^[0-9a-f]{64}\.pdf$/iu;
export const AGENT_DOSAGE_NOT_STATED = 'non indicata nel documento';
const SHOWN_FIELDS: Record<string, readonly string[]> = {
    therapy: ['drugName', 'activePrinciple', 'dosage', 'status', 'startDate', 'endDate'],
    service: ['serviceName', 'items', 'category', 'priority', 'clinicalQuestion', 'requestReference', 'prescribedAt'],
    diagnosis: ['description', 'code', 'system', 'date'],
    exemption: ['code'],
    observation: ['display', 'value', 'unit', 'refText', 'observedAt'],
};

export function agentReviewDay(value: string): string {
    const day = ISO_DAY.exec(value);
    return day ? `${day[3]}/${day[2]}/${day[1]}` : value;
}

export function agentReviewDisplayValue(field: string, value: string): string {
    if (DATE_FIELDS.has(field)) return agentReviewDay(value);
    if (field === 'dosage' && value === AGENT_DOSAGE_NOT_STATED) return 'Non indicata nel documento';
    return agentReviewFieldValues[field]?.[value] ?? value;
}

export function agentReviewShownFields(kind: string, values: Record<string, string>): Array<[string, string]> {
    return (SHOWN_FIELDS[kind] ?? []).filter(field => values[field]?.trim()).map(field => [field, values[field]!]);
}

export function agentReviewDocumentLabel(fileName: string, date: string | null | undefined): string {
    if (fileName === 'nota-visita.pdf') return 'Nota della visita';
    if (!HASH_FILE.test(fileName)) return fileName;
    return date ? `Documento del ${agentReviewDay(date)}` : 'Documento della visita';
}

export const agentReviewItemLabels = { note: 'Nota', transcription: 'Trascrizione', pdf: 'PDF', therapy: 'Terapia proposta',
    service: 'Prestazione proposta', diagnosis: 'Diagnosi proposta', exemption: 'Esenzione proposta', observation: 'Osservazione proposta' } as const;
