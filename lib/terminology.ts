/* @Codex */
export type TerminologySystemCode = 'AIC' | 'ATC' | 'ICD-11' | 'LOINC' | 'UCUM' | 'SNOMED-CT' | 'CND';

/* @Codex */
export type TerminologySystemDescriptor = {
    code: TerminologySystemCode;
    display: string;
    source: string;
    status: 'active' | 'planned';
    notes?: string;
};

/* @Codex */
export type TerminologyItem = {
    system: TerminologySystemCode;
    code: string;
    display: string;
    /* Etichetta italiana da mostrare come testo primario nella UI (WUL-UIUX). */
    displayIt?: string;
    /* Unita UCUM di default per un analita LOINC (WUL-UIUX). */
    defaultUnit?: string;
    version?: string | null;
    source: string;
};

/* @Codex */
type StaticCatalogItem = {
    code: string;
    display: string;
    /* Etichetta italiana: usata come testo primario, l'inglese resta metadata. */
    displayIt?: string;
    /* Unita UCUM di default suggerita per l'analita. */
    defaultUnit?: string;
    version?: string;
};

/* @Codex */
const SYSTEMS: TerminologySystemDescriptor[] = [
    { code: 'ICD-11', display: 'ICD-11', source: 'WHO local API proxy', status: 'active' },
    { code: 'AIC', display: 'AIC', source: 'AIFA local catalog', status: 'active' },
    { code: 'ATC', display: 'ATC', source: 'Derived from local AIFA catalog', status: 'active' },
    { code: 'LOINC', display: 'LOINC', source: 'Pilot local subset', status: 'active', notes: 'Vital signs pilot subset' },
    { code: 'UCUM', display: 'UCUM', source: 'Pilot local subset', status: 'active', notes: 'Unit-of-measure pilot subset' },
    { code: 'SNOMED-CT', display: 'SNOMED CT', source: 'Not integrated yet', status: 'planned' },
    { code: 'CND', display: 'CND', source: 'Not integrated yet', status: 'planned' },
];

/* @Codex */
const LOINC_PILOT: StaticCatalogItem[] = [
    { code: '8480-6', display: 'Systolic blood pressure', displayIt: 'Pressione arteriosa sistolica', defaultUnit: 'mm[Hg]', version: '2.78' },
    { code: '8462-4', display: 'Diastolic blood pressure', displayIt: 'Pressione arteriosa diastolica', defaultUnit: 'mm[Hg]', version: '2.78' },
    { code: '8867-4', display: 'Heart rate', displayIt: 'Frequenza cardiaca', defaultUnit: '/min', version: '2.78' },
    { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', displayIt: 'Saturazione O2 (SpO2)', defaultUnit: '%', version: '2.78' },
    { code: '8310-5', display: 'Body temperature', displayIt: 'Temperatura corporea', defaultUnit: 'Cel', version: '2.78' },
    { code: '29463-7', display: 'Body weight', displayIt: 'Peso corporeo', defaultUnit: 'kg', version: '2.78' },
    { code: '2339-0', display: 'Glucose [Mass/volume] in Blood', displayIt: 'Glicemia', defaultUnit: 'mg/dL', version: '2.78' },

    /* @Codex WUL-UIUX: subset ematologia/chimica clinica. Solo voci con codice
       LOINC e unita UCUM standard e non ambigui clinicamente (concordi tra
       revisione multi-agente e Codex 5.5). Le unita composte (10*3/uL, 10*6/uL)
       usano l'operatore asterisco UCUM e restano solo metadata: observation-range
       classifica il VALORE, mai l'unita. Le voci con ambiguita clinica (BUN vs
       urea, eGFR, LDL calc/diretto, TSH/FT4/FT3 unita, HbA1c NGSP/IFCC, PCR mg/L
       vs mg/dL, CO2/bicarbonati, calcio massa/moli) NON sono qui: vedi
       LOINC_PENDING_VALIDATION, da promuovere dopo validazione clinica. */
    // Emocromo
    { code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood', displayIt: 'Emoglobina (Hb)', defaultUnit: 'g/dL', version: '2.78' },
    { code: '4544-3', display: 'Hematocrit [Volume Fraction] of Blood by Automated count', displayIt: 'Ematocrito (Ht)', defaultUnit: '%', version: '2.78' },
    { code: '789-8', display: 'Erythrocytes [#/volume] in Blood by Automated count', displayIt: 'Globuli rossi (GR)', defaultUnit: '10*6/uL', version: '2.78' },
    { code: '6690-2', display: 'Leukocytes [#/volume] in Blood by Automated count', displayIt: 'Globuli bianchi (GB)', defaultUnit: '10*3/uL', version: '2.78' },
    { code: '777-3', display: 'Platelets [#/volume] in Blood by Automated count', displayIt: 'Piastrine (PLT)', defaultUnit: '10*3/uL', version: '2.78' },
    { code: '787-2', display: 'MCV [Entitic volume] by Automated count', displayIt: 'Volume corpuscolare medio (MCV)', defaultUnit: 'fL', version: '2.78' },
    { code: '785-6', display: 'MCH [Entitic mass] by Automated count', displayIt: 'Contenuto emoglobinico medio (MCH)', defaultUnit: 'pg', version: '2.78' },
    { code: '786-4', display: 'MCHC [Mass/volume] by Automated count', displayIt: 'Concentrazione emoglobinica media (MCHC)', defaultUnit: 'g/dL', version: '2.78' },
    { code: '788-0', display: 'Erythrocyte distribution width [Ratio] by Automated count', displayIt: 'Ampiezza distribuzione GR (RDW)', defaultUnit: '%', version: '2.78' },
    // Elettroliti
    { code: '2951-2', display: 'Sodium [Moles/volume] in Serum or Plasma', displayIt: 'Sodio (Na)', defaultUnit: 'mmol/L', version: '2.78' },
    { code: '2823-3', display: 'Potassium [Moles/volume] in Serum or Plasma', displayIt: 'Potassio (K)', defaultUnit: 'mmol/L', version: '2.78' },
    { code: '2075-0', display: 'Chloride [Moles/volume] in Serum or Plasma', displayIt: 'Cloro (Cl)', defaultUnit: 'mmol/L', version: '2.78' },
    // Funzione renale
    { code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma', displayIt: 'Creatinina', defaultUnit: 'mg/dL', version: '2.78' },
    // Funzione epatica
    { code: '1742-6', display: 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma', displayIt: 'ALT (GPT)', defaultUnit: 'U/L', version: '2.78' },
    { code: '1920-8', display: 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma', displayIt: 'AST (GOT)', defaultUnit: 'U/L', version: '2.78' },
    { code: '2324-2', display: 'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma', displayIt: 'GGT (gamma-GT)', defaultUnit: 'U/L', version: '2.78' },
    { code: '6768-6', display: 'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma', displayIt: 'Fosfatasi alcalina (ALP)', defaultUnit: 'U/L', version: '2.78' },
    { code: '1975-2', display: 'Bilirubin.total [Mass/volume] in Serum or Plasma', displayIt: 'Bilirubina totale', defaultUnit: 'mg/dL', version: '2.78' },
    { code: '1751-7', display: 'Albumin [Mass/volume] in Serum or Plasma', displayIt: 'Albumina', defaultUnit: 'g/dL', version: '2.78' },
    // Assetto lipidico
    { code: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', displayIt: 'Colesterolo totale', defaultUnit: 'mg/dL', version: '2.78' },
    { code: '2085-9', display: 'Cholesterol in HDL [Mass/volume] in Serum or Plasma', displayIt: 'Colesterolo HDL', defaultUnit: 'mg/dL', version: '2.78' },
    { code: '2571-8', display: 'Triglyceride [Mass/volume] in Serum or Plasma', displayIt: 'Trigliceridi', defaultUnit: 'mg/dL', version: '2.78' },
];

/*
 * @Codex WUL-UIUX: voci LOINC con ambiguita CLINICA che NON vanno spedite senza
 * la validazione di Leonardo (scelta di unita/formula/metodo con impatto sul
 * valore letto dal medico). NON incluse in staticCatalogFor: promuovere in
 * LOINC_PILOT una alla volta dopo aver confermato code + unita + eventuale
 * grandezza. La `note` documenta la decisione aperta.
 */
export const LOINC_PENDING_VALIDATION: (StaticCatalogItem & { note: string })[] = [
    { code: '2345-7', display: 'Glucose [Mass/volume] in Serum or Plasma', displayIt: 'Glicemia (siero/plasma)', defaultUnit: 'mg/dL', note: 'Distinta da 2339-0 (sangue/POCT), gia in catalogo: scegliere quale matrice esporre.' },
    { code: '2028-9', display: 'Carbon dioxide, total [Moles/volume] in Serum or Plasma', displayIt: 'CO2 totale (bicarbonati)', defaultUnit: 'mmol/L', note: 'Etichetta bicarbonati vs CO2 totale da confermare.' },
    { code: '17861-6', display: 'Calcium [Mass/volume] in Serum or Plasma', displayIt: 'Calcio totale (Ca)', defaultUnit: 'mg/dL', note: 'mg/dL (massa) vs mmol/L (moli, codice 2000-8): scelta clinica.' },
    { code: '3094-0', display: 'Urea nitrogen [Mass/volume] in Serum or Plasma', displayIt: 'Azoto ureico (BUN)', defaultUnit: 'mg/dL', note: 'BUN vs urea intera (22664-7): differenza fattore ~2,14. In Italia si referta spesso l\'urea.' },
    { code: '62238-1', display: 'Glomerular filtration rate/1.73 sq M.predicted (CKD-EPI)', displayIt: 'eGFR (CKD-EPI)', defaultUnit: 'mL/min/{1.73_m2}', note: 'Unita composta con annotazione UCUM; scelta della formula (CKD-EPI 2009/2021, MDRD) e clinica.' },
    { code: '13457-7', display: 'Cholesterol in LDL [Mass/volume] calculated', displayIt: 'Colesterolo LDL (calcolato)', defaultUnit: 'mg/dL', note: 'Calcolato (Friedewald) vs diretto (18262-6).' },
    { code: '3016-3', display: 'Thyrotropin [Units/volume] in Serum or Plasma', displayIt: 'TSH', defaultUnit: 'm[IU]/L', note: 'Notazione unita internazionali (mUI/L vs uUI/mL) da validare.' },
    { code: '3024-7', display: 'Thyroxine (T4) free [Mass/volume] in Serum or Plasma', displayIt: 'FT4 (tiroxina libera)', defaultUnit: 'ng/dL', note: 'ng/dL (massa) vs pmol/L (moli, 14920-3).' },
    { code: '3051-0', display: 'Triiodothyronine (T3) free [Mass/volume] in Serum or Plasma', displayIt: 'FT3 (triiodotironina libera)', defaultUnit: 'pg/mL', note: 'pg/mL (massa) vs pmol/L (moli).' },
    { code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood', displayIt: 'Emoglobina glicata (HbA1c)', defaultUnit: '%', note: 'NGSP (%) vs IFCC (mmol/mol, 59261-8); protocolli diversi, valori diversi.' },
    { code: '1988-5', display: 'C reactive protein [Mass/volume] in Serum or Plasma', displayIt: 'Proteina C reattiva (PCR)', defaultUnit: 'mg/L', note: 'mg/L vs mg/dL (fattore 10); hs-CRP e voce distinta (30522-7).' },
];

/* @Codex */
const UCUM_PILOT: StaticCatalogItem[] = [
    { code: 'mm[Hg]', display: 'millimeter of mercury', displayIt: 'mmHg', version: '2.1' },
    { code: '/min', display: 'per minute', displayIt: '/min', version: '2.1' },
    { code: '%', display: 'percent', displayIt: '%', version: '2.1' },
    { code: 'Cel', display: 'degree Celsius', displayIt: 'gradi C', version: '2.1' },
    { code: 'kg', display: 'kilogram', displayIt: 'kg', version: '2.1' },
    { code: 'mg/dL', display: 'milligram per deciliter', displayIt: 'mg/dL', version: '2.1' },
    /* @Codex WUL-UIUX: unita per il subset ematologia/chimica. Le composte usano
       l'operatore asterisco UCUM (10*3 = 10^3): stringa esatta come da UCUM. */
    { code: 'g/dL', display: 'gram per deciliter', displayIt: 'g/dL', version: '2.1' },
    { code: 'mmol/L', display: 'millimole per liter', displayIt: 'mmol/L', version: '2.1' },
    { code: 'U/L', display: 'enzyme unit per liter', displayIt: 'U/L', version: '2.1' },
    { code: 'fL', display: 'femtoliter', displayIt: 'fL', version: '2.1' },
    { code: 'pg', display: 'picogram', displayIt: 'pg', version: '2.1' },
    { code: '10*3/uL', display: 'thousands per microliter', displayIt: '10^3/uL', version: '2.1' },
    { code: '10*6/uL', display: 'millions per microliter', displayIt: '10^6/uL', version: '2.1' },
];

/* @Codex */
export function listTerminologySystems(): TerminologySystemDescriptor[] {
    return SYSTEMS;
}

/* @Codex */
export function normalizeTerminologySystem(value: unknown): TerminologySystemCode | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    if (normalized === 'ICD11' || normalized === 'ICD-11') return 'ICD-11';
    if (normalized === 'AIC') return 'AIC';
    if (normalized === 'ATC') return 'ATC';
    if (normalized === 'LOINC') return 'LOINC';
    if (normalized === 'UCUM') return 'UCUM';
    if (normalized === 'SNOMED' || normalized === 'SNOMED-CT' || normalized === 'SNOMED CT') return 'SNOMED-CT';
    if (normalized === 'CND') return 'CND';
    return null;
}

/* @Codex */
function staticCatalogFor(system: TerminologySystemCode): StaticCatalogItem[] | null {
    if (system === 'LOINC') return LOINC_PILOT;
    if (system === 'UCUM') return UCUM_PILOT;
    return null;
}

/* @Codex */
export function searchStaticTerminology(system: TerminologySystemCode, query: string, limit: number): TerminologyItem[] {
    const catalog = staticCatalogFor(system);
    if (!catalog) return [];

    const q = query.trim().toLowerCase();
    const filtered = catalog.filter((item) => {
        if (!q) return true;
        return item.code.toLowerCase().includes(q)
            || item.display.toLowerCase().includes(q)
            || (item.displayIt?.toLowerCase().includes(q) ?? false);
    });

    return filtered.slice(0, limit).map((item) => ({
        system,
        code: item.code,
        display: item.display,
        displayIt: item.displayIt,
        defaultUnit: item.defaultUnit,
        version: item.version ?? null,
        source: 'local-pilot-catalog',
    }));
}

/* @Codex */
export function resolveStaticTerminology(system: TerminologySystemCode, code: string): TerminologyItem | null {
    const catalog = staticCatalogFor(system);
    if (!catalog) return null;
    const match = catalog.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (!match) return null;
    return {
        system,
        code: match.code,
        display: match.display,
        displayIt: match.displayIt,
        defaultUnit: match.defaultUnit,
        version: match.version ?? null,
        source: 'local-pilot-catalog',
    };
}

/* @Codex */
export type FseValidationIssue = {
    field: string;
    code: string;
    message: string;
};

/* @Codex */
export type FseValidationResponse = {
    ok: boolean;
    profile: string;
    errors: FseValidationIssue[];
    warnings: FseValidationIssue[];
};

/* @Codex */
export function buildValidationResponse(profile: string, errors: FseValidationIssue[], warnings: FseValidationIssue[]): FseValidationResponse {
    return {
        ok: errors.length === 0,
        profile,
        errors,
        warnings,
    };
}
