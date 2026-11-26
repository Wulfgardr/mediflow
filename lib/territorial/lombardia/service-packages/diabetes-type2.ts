import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    LOMBARDIA_SERVICE_PACKAGE_SCHEMA,
    type ApprovedServicePackage,
    type DocumentSource,
    type PhysicianDecisionSource,
    type ServicePackageItem,
} from './contract';

const ALLEGATO_8_URL = 'https://www.regione.lombardia.it/content/dam/rl/canali-tematici-servizi/01-sanita/07-ticket-ed-esenzioni/ticket-esenzioni-prerstazioni-ssr/allegati/allegato-8-elenco-malattie-condizioni-croniche-ed-invalidanti-30-10-2026.pdf';
const NOMENCLATORE_URL = 'https://www.regione.lombardia.it/content/dam/rl/canali-tematici-servizi/01-sanita/07-ticket-ed-esenzioni/ticket-esenzioni-prerstazioni-ssr/allegati/Nomenclatore+tariffario+dal+1+ottobre+2025.xlsx';
const SID_AMD_2018_URL = 'https://aemmedi.it/wp-content/uploads/2009/06/AMD-Standard-unico1.pdf';

function allegato8(exemption: '013' | '023'): DocumentSource {
    return {
        kind: 'documento',
        document: 'Allegato 8 al DPCM 12/01/2017, malattie e condizioni croniche e invalidanti (versione Regione Lombardia aggiornata al 30/10/2026)',
        sectionOrTable: exemption === '013'
            ? 'Esenzione 013 Diabete mellito, pagine 22-23'
            : 'Esenzione 023 Insufficienza renale cronica, pagine 27-28',
        publishedAt: '2026-10-30',
        url: ALLEGATO_8_URL,
        status: 'vigente',
    };
}

export const NOMENCLATORE_2025: DocumentSource = {
    kind: 'documento',
    document: 'Nomenclatore regionale tariffario della specialistica ambulatoriale, Allegato 3 della DGR n. XII/4956 del 08/09/2025',
    sectionOrTable: 'Riga del codice, in vigore dal 01/10/2025',
    publishedAt: '2025-09-08',
    version: 'XII/4956',
    url: NOMENCLATORE_URL,
    status: 'vigente',
};

function sidAmd2018(sectionOrTable: string): DocumentSource {
    return {
        kind: 'documento',
        document: 'AMD-SID, Standard italiani per la cura del diabete mellito 2018',
        sectionOrTable,
        publishedAt: '2018-04-27',
        url: SID_AMD_2018_URL,
        status: 'riferimento_clinico',
    };
}

const SID_HBA1C = sidAmd2018('Cap. IV.B Valutazione del controllo glicemico, pagina 33 del PDF');
const SID_CARDIOVASCULAR_RISK = sidAmd2018('Cap. V.A Malattia cardiovascolare, pagina 141 del PDF; esami di laboratorio, pagina 32');
const SID_CARDIOVASCULAR_SCREENING = sidAmd2018('Cap. V.A.7 Screening della malattia cardiovascolare, pagina 173 del PDF');
const SID_NEPHROPATHY_SCREENING = sidAmd2018('Cap. V.B Nefropatia diabetica, screening e stadiazione, pagina 182 del PDF');
const SID_NEPHROPATHY_FOLLOW_UP = sidAmd2018('Cap. V.B Nefropatia diabetica, trattamento e sorveglianza, pagine 183 e 186 del PDF');
const SID_RETINOPATHY = sidAmd2018('Cap. V.C Retinopatia diabetica, screening e follow-up, pagine 190-191 del PDF');
const SID_NAFLD = sidAmd2018('Cap. V.H Epatopatia steatosica non alcolica, pagina 228 del PDF');

const PACKAGE_APPROVER = 'Leonardo Pegollo';
const DECIDED_ON = '2026-11-25';

function physicianDecision(decision: string): PhysicianDecisionSource {
    return { kind: 'decisione_del_medico', decidedBy: PACKAGE_APPROVER, decidedAt: DECIDED_ON, decision };
}

function labItem(item: Omit<ServicePackageItem, 'category' | 'priority'>): ServicePackageItem {
    return { ...item, category: 'lab', priority: 'P' };
}

const BASE_ITEMS: readonly ServicePackageItem[] = [
    {
        id: 'dm2-visita-endocrinologica',
        serviceCode: '89.01.8',
        serviceName: 'Visita endocrinologica di controllo',
        category: 'visit',
        priority: 'P',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: visita di controllo per il monitoraggio della malattia e delle complicanze',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [physicianDecision('Visita endocrinologica di controllo 89.01.8 ogni 12 mesi'), allegato8('013'), NOMENCLATORE_2025],
    },
    labItem({
        id: 'dm2-emoglobina-glicata',
        serviceCode: '90.28.1',
        serviceName: 'Hb - Emoglobina glicata',
        periodicityMonths: 6,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo del compenso glicemico',
        exemptionCode: '013',
        appropriatenessConditions: ['Ogni 3 mesi se il compenso è instabile o la terapia è cambiata'],
        sources: [SID_HBA1C, allegato8('013')],
    }),
    labItem({
        id: 'dm2-glicemia',
        serviceCode: '90.27.1',
        serviceName: 'Glucosio',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo della glicemia',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [physicianDecision('Glicemia 90.27.1 ogni 12 mesi'), allegato8('013')],
    }),
    labItem({
        id: 'dm2-colesterolo-totale',
        serviceCode: '90.14.3',
        serviceName: 'Colesterolo totale',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo del profilo lipidico',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [SID_CARDIOVASCULAR_RISK, allegato8('013')],
    }),
    labItem({
        id: 'dm2-colesterolo-hdl',
        serviceCode: '90.14.1',
        serviceName: 'Colesterolo HDL',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo del profilo lipidico',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [SID_CARDIOVASCULAR_RISK, allegato8('013')],
    }),
    labItem({
        id: 'dm2-trigliceridi',
        serviceCode: '90.43.2',
        serviceName: 'Trigliceridi',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo del profilo lipidico',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [SID_CARDIOVASCULAR_RISK, allegato8('013')],
    }),
    labItem({
        id: 'dm2-creatinina',
        serviceCode: '90.16.3',
        serviceName: 'Creatinina',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: stima del filtrato glomerulare',
        exemptionCode: '013',
        appropriatenessConditions: ['Non associabile a 90.16.4'],
        sources: [SID_NEPHROPATHY_SCREENING, allegato8('013'), NOMENCLATORE_2025],
    }),
    labItem({
        id: 'dm2-albuminuria',
        serviceCode: '90.33.4',
        serviceName: 'Albuminuria [Microalbuminuria]',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: screening della nefropatia',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [SID_NEPHROPATHY_SCREENING, allegato8('013')],
    }),
    labItem({
        id: 'dm2-esame-urine',
        serviceCode: '90.44.3',
        serviceName: 'Urine esame completo',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: esame delle urine di controllo',
        exemptionCode: '013',
        appropriatenessConditions: [],
        sources: [physicianDecision('Esame urine completo 90.44.3 ogni 12 mesi'), allegato8('013')],
    }),
    labItem({
        id: 'dm2-alt',
        serviceCode: '90.04.5',
        serviceName: 'Alanina aminotransferasi (ALT) (GPT)',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo degli enzimi epatici',
        exemptionCode: '013',
        appropriatenessConditions: ['Più frequente con valori patologici o steatosi epatica'],
        sources: [allegato8('013')],
    }),
    labItem({
        id: 'dm2-ast',
        serviceCode: '90.09.2',
        serviceName: 'Aspartato aminotransferasi (AST) (GOT)',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: controllo degli enzimi epatici',
        exemptionCode: '013',
        appropriatenessConditions: ['Più frequente con valori patologici o steatosi epatica'],
        sources: [allegato8('013')],
    }),
    {
        id: 'dm2-fotografia-fundus',
        serviceCode: '95.11',
        serviceName: 'Fotografia del fundus',
        category: 'imaging',
        priority: 'P',
        periodicityMonths: 24,
        clinicalQuestion: 'Diabete mellito tipo 2: screening della retinopatia',
        exemptionCode: '013',
        appropriatenessConditions: [
            'Ogni 12 mesi con retinopatia non proliferante lieve, ogni 6-12 mesi se moderata',
            'In alternativa: visita oculistica di controllo 89.01.D o prima visita oculistica 95.02',
        ],
        sources: [
            SID_RETINOPATHY,
            allegato8('013'),
            physicianDecision('Fotografia del fundus 95.11 ogni 24 mesi, preferita alla prima visita oculistica 95.02'),
            {
                kind: 'decisione_del_medico',
                decidedBy: PACKAGE_APPROVER,
                decidedAt: '2026-11-26',
                decision: 'Resta la fotografia del fundus 95.11, con visita oculistica di controllo 89.01.D indicata fra le alternative',
            },
        ],
    },
    {
        id: 'dm2-elettrocardiogramma',
        serviceCode: '89.52',
        serviceName: 'Elettrocardiogramma',
        category: 'procedure',
        priority: 'P',
        periodicityMonths: 12,
        clinicalQuestion: 'Diabete mellito tipo 2: screening cardiovascolare annuale',
        exemptionCode: '013',
        appropriatenessConditions: ['Non associabile a visita cardiologica 89.7A.3 o 89.01.3'],
        sources: [SID_CARDIOVASCULAR_SCREENING, allegato8('013'), NOMENCLATORE_2025],
    },
];

export const DIABETES_T2_PACKAGE: ApprovedServicePackage = {
    schemaVersion: LOMBARDIA_SERVICE_PACKAGE_SCHEMA,
    id: 'lom.dm2.monitoraggio',
    territory: 'lom',
    codeSystem: LOMBARDIA_SERVICE_CODE_SYSTEM,
    title: 'Monitoraggio diabete mellito tipo 2',
    approval: { status: 'approved', approvedBy: PACKAGE_APPROVER, approvedAt: DECIDED_ON },
    activation: {
        icd11Codes: ['5A11'],
        diagnosisLabel: 'Diabete mellito di tipo 2',
    },
    exemption: {
        code: '013',
        description: 'Diabete mellito',
        applicableWhen: 'Esenzione 013 riconosciuta all’assistito',
    },
    sources: [allegato8('013'), SID_HBA1C],
    baseItems: BASE_ITEMS,
    complicationModules: [
        {
            id: 'renale',
            title: 'Malattia renale cronica',
            triggerIcd11Codes: ['GB61'],
            sources: [SID_NEPHROPATHY_FOLLOW_UP, allegato8('023')],
            items: [
                labItem({
                    id: 'dm2-mrc-albuminuria',
                    serviceCode: '90.33.4',
                    serviceName: 'Albuminuria [Microalbuminuria]',
                    periodicityMonths: 6,
                    clinicalQuestion: 'Diabete mellito tipo 2 con malattia renale cronica: controllo dell’albuminuria',
                    exemptionCode: '013',
                    appropriatenessConditions: ['Sorveglianza semestrale della risposta alla terapia e della progressione'],
                    sources: [SID_NEPHROPATHY_FOLLOW_UP, allegato8('013')],
                }),
                labItem({
                    id: 'dm2-mrc-creatinina',
                    serviceCode: '90.16.3',
                    serviceName: 'Creatinina',
                    periodicityMonths: 12,
                    clinicalQuestion: 'Diabete mellito tipo 2 con malattia renale cronica: controllo del filtrato glomerulare',
                    exemptionCode: '013',
                    appropriatenessConditions: ['Più ravvicinata se la funzione renale è ridotta'],
                    sources: [SID_NEPHROPATHY_FOLLOW_UP, allegato8('013')],
                }),
                labItem({
                    id: 'dm2-mrc-potassio',
                    serviceCode: '90.37.4',
                    serviceName: 'Potassio',
                    periodicityMonths: 12,
                    clinicalQuestion: 'Diabete mellito tipo 2 con malattia renale cronica: controllo della potassiemia',
                    exemptionCode: '023',
                    appropriatenessConditions: [
                        'Con ACE-inibitore o sartano: anche 1-2 settimane dopo l’inizio o un aumento di dose',
                        'Più ravvicinata se la funzione renale è ridotta',
                    ],
                    sources: [SID_NEPHROPATHY_FOLLOW_UP, allegato8('023')],
                }),
            ],
        },
        {
            id: 'cardiologico',
            title: 'Cardiopatia ischemica',
            triggerIcd11Codes: ['BA40', 'BA50', 'BA52'],
            sources: [SID_CARDIOVASCULAR_SCREENING, allegato8('013')],
            items: [
                {
                    id: 'dm2-cv-tronchi-sovraaortici',
                    serviceCode: '88.73.5',
                    serviceName: 'Eco(color)dopplergrafia dei tronchi sovraaortici',
                    category: 'imaging',
                    priority: 'P',
                    periodicityMonths: 24,
                    clinicalQuestion: 'Diabete mellito tipo 2 ad alto rischio cardiovascolare: controllo dei tronchi sovraaortici',
                    exemptionCode: '013',
                    appropriatenessConditions: [
                        'Da ripetere ogni 1-3 anni secondo l’esito precedente',
                        'In esenzione 013 non più di una volta l’anno',
                    ],
                    sources: [SID_CARDIOVASCULAR_SCREENING, allegato8('013')],
                },
            ],
        },
        {
            id: 'epatico',
            title: 'Steatosi epatica non alcolica',
            triggerIcd11Codes: ['DB92'],
            sources: [SID_NAFLD, allegato8('013')],
            items: [
                {
                    id: 'dm2-epatico-ecografia',
                    serviceCode: '88.74.1',
                    serviceName: 'Ecografia dell’addome superiore',
                    category: 'imaging',
                    priority: 'P',
                    periodicityMonths: 24,
                    clinicalQuestion: 'Diabete mellito tipo 2 con steatosi epatica: controllo ecografico',
                    exemptionCode: '013',
                    appropriatenessConditions: [
                        'Ogni 2-3 anni secondo il giudizio clinico',
                        'Escludere periodicamente la fibrosi avanzata con FIB-4 o elastografia',
                        'In esenzione 013 non più di una volta l’anno',
                    ],
                    sources: [SID_NAFLD, allegato8('013')],
                },
            ],
        },
    ],
};
