/* @Codex */
export const SYNTHETIC_LAB_REPORT_FIXTURES = [
    {
        id: 'columns-and-decimal-comma',
        text: `REFERT0 SINTETICO - CHIMICA CLINICA
Esame    Risultato    Unita    Valori di riferimento
Creatinina    1,35 *    mg/dL    0,50 - 1,10    H
Sodio         140       mmol/L   136 - 145`,
        expectedAnalytes: ['Creatinina', 'Sodio'],
    },
    {
        id: 'pipes-and-unilateral-bound',
        text: `CAMPIONE SINTETICO
Proteina C reattiva | 3,2 | mg/L | < 5
Potassio | 3,1 | mmol/L | 3,5-5,1 | L`,
        expectedAnalytes: ['Proteina C reattiva', 'Potassio'],
    },
    {
        id: 'hematology-stars-and-ucum',
        text: `EMATOLOGIA
Emoglobina;** 10,8;g/dL;12,0 - 16,0;BASSO
Globuli bianchi\t7,20\t10^3/uL\t4,00-10,00`,
        expectedAnalytes: ['Emoglobina', 'Globuli bianchi'],
    },
] as const;
