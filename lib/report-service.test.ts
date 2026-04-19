/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type AutoTableCall = {
    startY: number;
    head: string[][];
    body: string[][];
};

class FakeJsPDF {
    static instances: FakeJsPDF[] = [];
    static pageHeight = 160;

    internal = {
        pageSize: {
            width: 210,
            height: FakeJsPDF.pageHeight,
        },
    };

    lastAutoTable = { finalY: 0 };
    pageCount = 1;
    texts: string[] = [];
    autoTableCalls: AutoTableCall[] = [];
    savedFilename?: string;

    constructor() {
        this.internal.pageSize.height = FakeJsPDF.pageHeight;
        FakeJsPDF.instances.push(this);
    }

    setFillColor() { return this; }
    rect() { return this; }
    setFontSize() { return this; }
    setTextColor() { return this; }
    setFont() { return this; }
    setDrawColor() { return this; }
    line() { return this; }
    roundedRect() { return this; }

    text(value: string | string[]) {
        this.texts.push(Array.isArray(value) ? value.join('\n') : value);
        return this;
    }

    splitTextToSize(value: string, _width: number) {
        return value.length > 48 ? value.match(/.{1,48}/g) ?? [value] : [value];
    }

    addPage() {
        this.pageCount += 1;
        return this;
    }

    save(filename: string) {
        this.savedFilename = filename;
    }
}

const moduleWithLoad = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === 'jspdf') {
        return FakeJsPDF;
    }

    if (request === 'jspdf-autotable') {
        return (doc: FakeJsPDF, options: AutoTableCall) => {
            doc.autoTableCalls.push({
                startY: options.startY,
                head: options.head,
                body: options.body,
            });
            doc.lastAutoTable.finalY = options.startY + 10 + (options.body.length * 8);
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

process.on('exit', () => {
    moduleWithLoad._load = originalLoad;
});

async function renderReport(
    patient: unknown,
    entries: unknown[],
    lastScales: unknown[],
    therapies: unknown[],
    observations: unknown[],
) {
    FakeJsPDF.instances = [];
    const { generatePatientReport } = await import('./report-service');
    generatePatientReport(
        patient as never,
        entries as never,
        lastScales as never,
        therapies as never,
        observations as never,
    );
    const doc = FakeJsPDF.instances.at(-1);
    assert.ok(doc, 'expected one PDF document instance');
    return doc;
}

test('generatePatientReport renders ICD, therapy, diary, observations and scales across pages', async () => {
    FakeJsPDF.pageHeight = 140;

    const patient = {
        firstName: 'Giulia',
        lastName: 'Bianchi',
        taxCode: 'BNCGLI80A41H501T',
        address: 'Via Roma 1',
        phone: '3331234567',
        caregiver: 'Mario Bianchi',
        monitoringProfile: 'taken_in_charge',
        notes: 'Nota clinica estesa '.repeat(12),
        diagnoses: [
            {
                system: 'ICD-10',
                code: 'I10',
                description: 'Ipertensione essenziale',
                date: '2025-03-10T00:00:00Z',
            },
        ],
    };

    const entries = Array.from({ length: 30 }, (_, index) => ({
        id: `entry-${index}`,
        patientId: 'patient-1',
        date: new Date(`2025-03-${String((index % 9) + 10).padStart(2, '0')}T08:00:00Z`),
        type: 'note',
        title: `Nota ${index}`,
        content: `Contenuto diario ${index}`,
        createdAt: new Date('2025-03-10T00:00:00Z'),
        updatedAt: new Date('2025-03-10T00:00:00Z'),
    }));

    const diaryEntries = [
        ...entries,
        {
            id: 'entry-scale',
            patientId: 'patient-1',
            date: new Date('2025-03-12T00:00:00Z'),
            type: 'scale',
            title: 'Scala',
            content: 'Non deve finire nel diario',
            createdAt: new Date('2025-03-10T00:00:00Z'),
            updatedAt: new Date('2025-03-10T00:00:00Z'),
        },
        {
            id: 'entry-deleted',
            patientId: 'patient-1',
            date: new Date('2025-03-12T00:00:00Z'),
            type: 'note',
            title: 'Cancellata',
            content: 'Non deve finire nel diario',
            createdAt: new Date('2025-03-10T00:00:00Z'),
            updatedAt: new Date('2025-03-10T00:00:00Z'),
            deletedAt: new Date('2025-03-13T00:00:00Z'),
        },
    ];

    const lastScales = [
        {
            id: 'scale-1',
            patientId: 'patient-1',
            date: new Date('2025-03-11T00:00:00Z'),
            type: 'scale',
            title: 'MMSE',
            content: 'Score',
            metadata: { title: 'MMSE', score: '28/30', interpretation: 'Nella norma' },
            createdAt: new Date('2025-03-10T00:00:00Z'),
            updatedAt: new Date('2025-03-10T00:00:00Z'),
        },
    ];

    const therapies = [
        {
            id: 'therapy-1',
            patientId: 'patient-1',
            drugName: 'Ramipril',
            activePrinciple: 'Ramipril',
            dosage: '5 mg/die',
            motivation: 'Controllo pressorio',
            status: 'active',
            startDate: new Date('2025-03-01T00:00:00Z'),
            createdAt: new Date('2025-03-01T00:00:00Z'),
        },
        {
            id: 'therapy-2',
            patientId: 'patient-1',
            drugName: 'Farmaco chiuso',
            dosage: '1 cp',
            status: 'completed',
            startDate: new Date('2025-02-01T00:00:00Z'),
            createdAt: new Date('2025-02-01T00:00:00Z'),
        },
    ];

    const observations = [
        {
            id: 'obs-1',
            patientId: 'patient-1',
            codeSystem: 'LOINC',
            code: '8480-6',
            display: 'Pressione sistolica',
            value: '138',
            unitCode: 'mm[Hg]',
            notes: 'Controllo domiciliare',
            observedAt: new Date('2025-03-13T00:00:00Z'),
            createdAt: new Date('2025-03-13T00:00:00Z'),
        },
    ];

    const doc = await renderReport(patient, diaryEntries, lastScales, therapies, observations);

    assert.match(doc.savedFilename ?? '', /^Report_Bianchi_Giulia_\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.ok(doc.pageCount > 1, 'expected report pagination to add at least one page');
    assert.ok(doc.texts.includes('Diagnosi ICD'));
    assert.ok(doc.texts.includes('Terapia Farmacologica Attiva'));
    assert.ok(doc.texts.includes('Diario Clinico (Ultime Attività)'));
    assert.ok(doc.texts.includes('Osservazioni Codificate (LOINC + UCUM)'));
    assert.ok(doc.texts.includes('Valutazioni Recenti (Scale)'));
    assert.equal(doc.autoTableCalls.length, 5);
    assert.deepEqual(doc.autoTableCalls[0].body[0], ['ICD-10', 'I10', 'Ipertensione essenziale', '10/03/2025']);
    assert.equal(doc.autoTableCalls[1].body.length, 1);
    assert.equal(doc.autoTableCalls[1].body[0][0], 'Ramipril');
    assert.equal(doc.autoTableCalls[2].body.length, 30);
    assert.ok(doc.autoTableCalls[2].body.every((row) => row[1] !== 'SCALE'));
    assert.equal(doc.autoTableCalls[3].body[0][2], '8480-6');
    assert.equal(doc.autoTableCalls[4].body[0][1], 'MMSE');
}
);

test('generatePatientReport renders explicit empty states when data is missing', async () => {
    FakeJsPDF.pageHeight = 220;

    const patient = {
        firstName: 'Mario',
        lastName: 'Rossi',
        taxCode: 'RSSMRA80A01H501U',
        address: '',
        phone: '',
        monitoringProfile: 'episodic',
        diagnoses: [],
    };

    const doc = await renderReport(patient, [], [], [], []);

    assert.equal(doc.autoTableCalls.length, 0);
    assert.ok(doc.texts.includes('Estemporanea'));
    assert.ok(doc.texts.includes('Nessuna diagnosi ICD presente.'));
    assert.ok(doc.texts.includes('Nessuna terapia attiva registrata.'));
    assert.ok(doc.texts.includes('Nessun elemento nel diario clinico.'));
    assert.ok(doc.texts.includes('Nessuna osservazione codificata disponibile.'));
    assert.ok(doc.texts.includes('Nessuna valutazione recente disponibile.'));
}
);
