export const agentReviewFieldLabels: Record<string, string> = { drugName: 'Farmaco', activePrinciple: 'Principio attivo', dosage: 'Posologia', status: 'Stato', startDate: 'Dal', endDate: 'Al', aic: 'AIC', atc: 'ATC', serviceName: 'Prestazione', items: 'Voci', category: 'Categoria', priority: 'Priorità', prescribedAt: 'Prescritta il', requestReference: 'Riferimento', clinicalQuestion: 'Quesito clinico', description: 'Descrizione', code: 'Codice', system: 'Sistema', date: 'Data', display: 'Esame', value: 'Valore', unit: 'Unità', unitCode: 'Codice unità', refText: 'Intervallo di riferimento', refLow: 'Limite inferiore', refHigh: 'Limite superiore', observedAt: 'Misurato il', subject: 'Soggetto', temporality: 'Periodo', certainty: 'Certezza' };

export const agentReviewFieldValues: Record<string, Record<string, string>> = {
    status: { active: 'In corso', suspended: 'Sospesa', completed: 'Conclusa', prescribed: 'Prescritta', booked: 'Prenotata', performed: 'Eseguita', report_received: 'Referto ricevuto', cancelled: 'Annullata' },
    category: { lab: 'Laboratorio', imaging: 'Imaging', visit: 'Visita', rehab: 'Riabilitazione', screening: 'Screening', procedure: 'Procedura', other: 'Altro' },
    priority: { routine: 'Routine', P: 'Programmata (P)', D: 'Differibile (D)', B: 'Breve (B)', U: 'Urgente (U)', unknown: 'Non indicata' },
};

export const agentReviewItemLabels = { note: 'Nota', transcription: 'Trascrizione', pdf: 'PDF', therapy: 'Terapia proposta',
    service: 'Prestazione proposta', diagnosis: 'Diagnosi proposta', exemption: 'Esenzione proposta', observation: 'Osservazione proposta' } as const;
