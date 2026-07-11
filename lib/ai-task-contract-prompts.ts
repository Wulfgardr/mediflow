/* @Codex */
export const AI_TASK_EXTRACTION_SCHEMA_VERSION = 'mediflow.ai.extract.v1';

type PromptTaskKind = 'patient_insight' | 'smart_import' | 'document_synthesis';

export function buildExtractionPrompt(
    task: PromptTaskKind,
    taskObjective: string,
    dataShape: string,
    rules: string[],
    contextLabel: string,
    contextBody: string
): string {
    return [
        taskObjective,
        '',
        'Restituisci SOLO JSON valido, senza testo extra, senza backticks, senza commenti.',
        'Usa esattamente questo envelope:',
        '{',
        `  "schemaVersion": "${AI_TASK_EXTRACTION_SCHEMA_VERSION}",`,
        `  "task": "${task}",`,
        '  "summary": "stringa breve in plain text, oppure vuota",',
        `  "data": ${dataShape}`,
        '}',
        '',
        'Regole comuni:',
        '- usa solo doppi apici JSON standard',
        '- non usare null: preferisci stringa vuota o array vuoto',
        '- non aggiungere campi extra',
        ...rules.map((rule) => `- ${rule}`),
        '',
        `${contextLabel}:`,
        contextBody,
    ].join('\n');
}

export function buildPatientInsightExtractionPrompt(contextPrompt: string): string {
    return buildExtractionPrompt(
        'patient_insight',
        [
            'Sei un assistente medico locale.',
            'Obiettivo: estrarre un insight clinico breve, concreto, neutro e orientato al follow-up attuale, senza produrre markdown finale.',
        ].join('\n'),
        `{
    "currentState": ["frase breve con [Sx] o [DATI-INCOMPLETI]"],
    "alerts": ["bullet breve con [Sx] o [DATI-INCOMPLETI]"],
    "nextSteps": ["bullet operativo con [Sx] o [DATI-INCOMPLETI]"],
    "gaps": ["bullet breve con [Sx] o [DATI-INCOMPLETI]"]
  }`,
        [
            'currentState massimo 2 frasi brevi',
            'alerts massimo 2 elementi',
            'nextSteps massimo 3 elementi',
            'gaps massimo 1 elemento e solo se utile',
            'gaps solo per informazioni mancanti che limitano interpretazione, priorita o decisione clinica attuale',
            'currentState descrive il quadro clinico attuale e il follow-up immediato, non deve assorbire alert di sicurezza o monitoraggio attivo',
            'apri currentState dal problema clinico o follow-up piu attuale, non dalla lista completa delle comorbidita',
            'usa la seconda frase di currentState solo se aggiunge un secondo fatto clinico attuale o un follow-up immediato; non usarla per inventariare comorbidita croniche, terapia di sfondo o codici storici non decisivi',
            'se diario o documenti recenti descrivono un episodio acuto, una dimissione o un percorso riabilitativo, tieni entrambe le frasi di currentState ancorate a quell episodio o al suo follow-up immediato',
            'nei documenti recenti di dimissione, PS o riabilitazione, tratta mobilita ridotta, ausili, ADI/FKT e recupero funzionale come follow-up clinico attivo',
            'menziona la storia remota solo se cambia la gestione attuale',
            'non combinare nel currentState il problema attuale con comorbidita croniche non direttamente coinvolte nell evento o follow-up corrente',
            'se valori recenti o controlli pendenti riguardano una cronica attiva, mantieni esplicita la patologia nel currentState',
            'non citare diagnosi codificate o terapie attive di sfondo solo perche presenti nel contesto',
            'nei casi post-dimissione, post-PS o riabilitativi non riportare in nextSteps diagnosi o terapie croniche di sfondo se non sono esplicitamente collegate all episodio attuale o a un controllo pendente',
            'alerts solo per criticita cliniche o di sicurezza chiaramente attive nel contesto locale',
            'usa alerts per peggioramento recente, valori chiaramente anomali, sospensione o stop temporaneo di terapia, episodio acuto non ancora risolto, limitazione funzionale o ausilio che cambia sicurezza o monitoraggio',
            'nei casi post-dimissione o riabilitativi, usa alerts per limiti funzionali, deambulatore, mobilita ridotta o recupero da rivalutare se sono ancora aperti',
            'se un contenuto segnala rischio o richiede sorveglianza ravvicinata, mettilo in alerts anche se spiega il currentState o motiva un nextStep',
            'se non esistono alert reali o di sicurezza, lascia alerts vuoto',
            'se alerts e vuoto, ricontrolla che currentState e nextSteps non stiano nascondendo peggioramento, stop terapeutici, rivalutazioni urgenti, valori anomali o limiti funzionali rilevanti',
            'nextSteps solo se derivano da controlli pendenti, diario recente, osservazioni recenti, documenti recenti o terapie attive',
            'nextSteps deve contenere azioni, controlli o verifiche; non usare nextSteps per spostare fuori da alerts una criticita clinica attiva',
            'lascia gaps vuoto se il caso e gia interpretabile e i prossimi passi sono gia chiari con i dati presenti',
            'in gaps privilegia aderenza, risposta a terapia, andamento funzionale, sintomi non rivalutati o dati che mancano per leggere il problema attuale; evita gap generici che ripetono semplicemente esami gia programmati',
            'non usare gaps per duplicare nextSteps, per elencare dati mancanti ovvi o per riempire spazio',
            'ogni stringa deve gia includere [Sx] o [DATI-INCOMPLETI]',
            'hard fail interno: se anche una sola stringa non contiene [Sx] o [DATI-INCOMPLETI], correggi il JSON prima di rispondere',
            'mantieni sempre i marker [Sx] anche quando riassumi piu fatti clinici nella stessa stringa',
            'usa solo riferimenti [Sx] presenti nel contesto',
            'non usare placeholder come [Sx], [S?] o riferimenti generici: ogni citation deve corrispondere a un id reale presente nel contesto',
            'non usare markdown nelle stringhe oltre ai marker [Sx] o [DATI-INCOMPLETI]',
            'non inventare diagnosi, esami, terapie o fonti',
            'non scrivere frasi rassicuranti o boilerplate come nessuna criticita se il contesto contiene episodio acuto recente, valore anomalo, stop terapeutico, limitazione funzionale o ausilio clinicamente rilevante',
            'evita etichette inferite o enfatiche come fragilita alta, elevato rischio, complesso o pericoloso se non esplicite nelle fonti',
            'non trasformare da soli codici storici, fattori sociali o stili di vita in counselling o piani generici se non esiste follow-up attivo documentato',
            'se il supporto e debole, preferisci un gap esplicito a una raccomandazione speculativa',
            'usa un italiano clinico neutro e non moralizzante',
        ],
        'DATI PAZIENTE',
        contextPrompt,
    );
}
