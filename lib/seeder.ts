import { db, type Checkup } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';


// --- Data Pools & Configuration ---

const FIRST_NAMES_MALE = [
    "Marco", "Luca", "Giuseppe", "Giovanni", "Francesco", "Alessandro", "Andrea", "Matteo",
    "Lorenzo", "Davide", "Simone", "Federico", "Stefano", "Riccardo", "Fabio", "Paolo",
    "Antonio", "Roberto", "Massimo", "Michele", "Nicola", "Daniele", "Emanuele", "Filippo",
    "Alberto", "Enrico", "Claudio", "Cristian", "Vincenzo", "Salvatore", "Mario", "Luigi", "Pietro"
];

const FIRST_NAMES_FEMALE = [
    "Maria", "Giulia", "Francesca", "Sara", "Laura", "Chiara", "Valentina", "Anna",
    "Alessia", "Martina", "Elisa", "Federica", "Silvia", "Elena", "Roberta", "Paola",
    "Monica", "Claudia", "Lucia", "Teresa", "Angela", "Carla", "Rosa", "Giovanna",
    "Antonella", "Daniela", "Simona", "Cristina", "Marta", "Patrizia", "Sofia", "Giorgia"
];

const LAST_NAMES = [
    "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci",
    "Marino", "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Mancini", "Costa",
    "Giordano", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Fontana", "Santoro", "Mariani",
    "Rinaldi", "Caruso", "Ferrara", "Galli", "Martini", "Leone", "Longo", "Gentile",
    "Martinelli", "Vitale", "Lombardo", "Serra", "Coppola", "De Santis", "D'Angelo", "Marchetti"
];

const CITIES = [
    "Milano", "Roma", "Napoli", "Torino", "Palermo", "Genova", "Bologna", "Firenze",
    "Bari", "Catania", "Venezia", "Verona", "Messina", "Padova", "Trieste", "Brescia"
];

const STREETS = [
    "Via Roma", "Via Milano", "Via Garibaldi", "Via Mazzini", "Via Dante", "Via Verdi",
    "Corso Italia", "Viale Europa", "Via Nazionale", "Piazza della Repubblica"
];

// Complex Condition Profiles (ICD-11 Ecosystem)
// Each profile defines related drugs, symptoms, and potential checkups
interface ConditionProfile {
    code: string; // ICD-11 Code
    title: string;
    drugs: Array<{ name: string; dosage: string; category: string }>;
    symptoms: string[];
    checkupTypes: Checkup['type'][]; // e.g., 'blood_pressure', 'weight', 'glycemia'
}

const CONDITIONS: ConditionProfile[] = [
    {
        code: "5A11",
        title: "Diabete mellito di tipo 2",
        drugs: [
            { name: "Metformina 500mg", dosage: "1 cpr x 3/die", category: "diabete" },
            { name: "Metformina 850mg", dosage: "1 cpr x 2/die", category: "diabete" },
            { name: "Gliclazide 30mg", dosage: "1 cpr colazione", category: "diabete" }
        ],
        symptoms: ["polidipsia", "poliuria", "astenia", "parestesie"],
        checkupTypes: ["glycemia", "weight"]
    },
    {
        code: "BA00",
        title: "Ipertensione essenziale",
        drugs: [
            { name: "Ramipril 5mg", dosage: "1 cpr/die", category: "ipertensione" },
            { name: "Amlodipina 5mg", dosage: "1 cpr/die", category: "ipertensione" },
            { name: "Bisoprololo 2.5mg", dosage: "1 cpr/die", category: "cardiaco" },
            { name: "Furosemide 25mg", dosage: "1 cpr mattino", category: "diuretico" }
        ],
        symptoms: ["cefalea nucale", "vertigini", "ronzii auricolari"],
        checkupTypes: ["blood_pressure"]
    },
    {
        code: "CA40",
        title: "Insufficienza cardiaca",
        drugs: [
            { name: "Bisoprololo 1.25mg", dosage: "1 cpr/die", category: "cardiaco" },
            { name: "Furosemide 25mg", dosage: "1 cpr x 2/die", category: "diuretico" },
            { name: "Spironolattone 25mg", dosage: "1 cpr/die", category: "diuretico" }
        ],
        symptoms: ["dispnea da sforzo", "edemi declivi", "astenia", "ortopnea"],
        checkupTypes: ["blood_pressure", "weight", "sp02"]
    },
    {
        code: "DB90",
        title: "Broncopneumopatia cronica ostruttiva (BPCO)",
        drugs: [
            { name: "Salbutamolo spray", dosage: "al bisogno", category: "respiratorio" },
            { name: "Tiotropio inalatore", dosage: "1 puff/die", category: "respiratorio" }
        ],
        symptoms: ["tosse produttiva", "dispnea", "respiro sibilante"],
        checkupTypes: ["sp02"]
    },
    {
        code: "MA14",
        title: "Artrosi polidistrettuale",
        drugs: [
            { name: "Paracetamolo 1000mg", dosage: "1 cpr al bisogno", category: "dolore" },
            { name: "Ibuprofene 600mg", dosage: "1 cpr a stomaco pieno", category: "dolore" }
        ],
        symptoms: ["dolore articolare", "rigidità mattutina", "limitazione funzionale"],
        checkupTypes: ["adl", "pain"]
    }
];

// --- Utility Functions ---

function randomFrom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateTaxCode(): string {
    const hex = '0123456789ABCDEF';
    // Use timestamp + random for uniqueness
    let code = 'TEST-' + Date.now().toString().slice(-5) + '-';
    for (let i = 0; i < 5; i++) code += randomFrom(hex.split(''));
    return code;
}

// --- Generators ---

async function generatePDF(type: string, patientName: string, date: Date): Promise<Blob> {
    // Dynamic import for robustness
    const mod = await import('jspdf');
    const JsPDF = (mod as any).jsPDF ?? (mod as any).default ?? mod;
    const doc = new JsPDF();

    // Ensure fonts/setup if needed
    // ... existing generation logic ...

    const dateStr = date.toLocaleDateString('it-IT');

    // Header
    doc.setFontSize(22);
    doc.setTextColor(40, 40, 100);
    doc.text("Ospedale San Raffaele - Milano", 20, 20);

    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text("Dipartimento di Medicina Generale", 20, 28);

    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);

    // Patient Info
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text(`REFERTO: ${type.toUpperCase()}`, 20, 50);

    doc.setFontSize(11);
    doc.text(`Paziente: ${patientName}`, 20, 60);
    doc.text(`Data Esame: ${dateStr}`, 20, 66);
    doc.text(`ID Referto: REF-${randomInt(10000, 99999)}`, 140, 60);

    // Body based on type
    doc.setFont("helvetica", "normal");
    doc.text("Quesito Clinico:", 20, 80);
    if (type === 'Esami Ematici') {
        doc.text("Controllo routine patologia cronica.", 60, 80);

        doc.setFontSize(10);
        let y = 100;
        doc.text("ESAME", 20, y); doc.text("RISULTATO", 80, y); doc.text("UNITÀ", 120, y); doc.text("RIFERIMENTO", 150, y);
        y += 5;
        doc.line(20, y, 190, y);
        y += 10;

        const labs = [
            { name: "Glucosio", val: randomInt(70, 140), max: 100, u: "mg/dL" },
            { name: "Creatinina", val: (Math.random() * 0.8 + 0.6).toFixed(2), max: 1.2, u: "mg/dL" },
            { name: "Colesterolo Tot", val: randomInt(150, 240), max: 200, u: "mg/dL" },
            { name: "Emoglobina", val: (Math.random() * 4 + 11).toFixed(1), max: 13.5, u: "g/dL" },
            { name: "Globuli Bianchi", val: (Math.random() * 5 + 4).toFixed(1), max: 10, u: "x10^9/L" }
        ];

        labs.forEach((lab) => {
            const isHigh = Number(lab.val) > lab.max;
            if (isHigh) doc.setTextColor(200, 0, 0); // Red if high
            doc.text(lab.name, 20, y);
            doc.text(`${lab.val} ${isHigh ? '*' : ''}`, 80, y);
            doc.setTextColor(0);
            doc.text(lab.u, 120, y);
            doc.text(`< ${lab.max}`, 150, y);
            y += 8;
        });

        doc.text("Conclusioni: Parametri sostanzialmente nella norma, salvo evidenziati.", 20, y + 20);
    } else if (type === 'Visita Specialistica') {
        doc.text("Valutazione internistica.", 60, 80);
        doc.text("Anamnesi:", 20, 100);
        doc.text("Paziente in buone condizioni generali. Riferisce lieve astenia.", 20, 106);
        doc.text("Esame Obiettivo:", 20, 120);
        doc.text("Torace: MV fisiologico. Cuore: toni ritmici, pause libere.", 20, 126);
        doc.text("Addome: trattabile, non dolente. Arti inf: no edemi.", 20, 132);
        doc.text("Conclusioni:", 20, 145);
        doc.text("Si consiglia prosecuzione terapia in atto.", 20, 151);
    }

    // Footer
    doc.line(20, 260, 190, 260);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`Generato da MediFlow Data Seeder il ${new Date().toLocaleDateString()}`, 20, 270);
    doc.text("Documento firmato digitalmente", 150, 270);

    return doc.output('blob');
}

// --- Main Seeder Options ---

export interface SeedOptions {
    patientCount: number;
    includeEntries: boolean;
    includeTherapies: boolean;
    includeConditions: boolean;
    onProgress?: (current: number, total: number) => void;
}

export async function seedDatabase(options: SeedOptions): Promise<{ count: number }> {
    const { patientCount, includeEntries, includeTherapies, includeConditions, onProgress } = options;
    console.log(`🚀 Starting ecosystem seeding for ${patientCount} patients...`);

    for (let i = 0; i < patientCount; i++) {
        try {
            // 1. Basic Patient Info
            const isFemale = Math.random() > 0.5;
            const firstName = randomFrom(isFemale ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);
            const lastName = randomFrom(LAST_NAMES);

            // Age bias towards elderly for realistic medical data (60-95)
            // small chance of younger
            const age = Math.random() > 0.1 ? randomInt(65, 95) : randomInt(30, 60);
            const birthDate = new Date();
            birthDate.setFullYear(birthDate.getFullYear() - age);
            birthDate.setMonth(randomInt(0, 11));
            birthDate.setDate(randomInt(1, 28));

            const patientId = uuidv4();

            // 2. Assign Conditions (Ecosystem)
            // 30% healthy, 70% with 1-3 chronic conditions
            const activeConditions: ConditionProfile[] = [];
            if (includeConditions && Math.random() > 0.3) {
                const numConds = randomInt(1, 3);
                const shuffled = [...CONDITIONS].sort(() => 0.5 - Math.random());
                activeConditions.push(...shuffled.slice(0, numConds));
            }

            const conditionNotes = activeConditions.map(c => `[${c.code}] ${c.title}`).join('\n');
            const baseNotes = `Anamnesi: Paziente di anni ${age}. ${activeConditions.length > 0 ? 'Polipatologico.' : 'In buona salute apparente.'}`;

            console.log(`Seeder: Generating patient ${i + 1}/${patientCount} - ${firstName} ${lastName}`);

            try {
                await db.patients.add({
                    id: patientId,
                    firstName,
                    lastName,
                    taxCode: generateTaxCode(),
                    birthDate,
                    address: `${randomFrom(STREETS)} ${randomInt(1, 200)}, ${randomFrom(CITIES)}`,
                    phone: '3' + randomInt(10, 99) + randomInt(1000000, 9999999),
                    isAdi: age > 80 && Math.random() > 0.5,
                    notes: `${baseNotes}\n\n${conditionNotes}`,
                    updatedAt: new Date(),
                    createdAt: new Date()
                });
            } catch (addError) {
                console.error(`Failed to add patient ${patientId} (${firstName} ${lastName}):`, addError);
                throw new Error(`Failed to insert patient ${firstName} ${lastName}: ${addError}`);
            }

            // 3. Generate Therapies based on Conditions
            if (includeTherapies) {
                for (const cond of activeConditions) {
                    for (const drug of cond.drugs) {
                        // 80% chance to be taking the drug
                        if (Math.random() > 0.2) {
                            await db.therapies.add({
                                id: uuidv4(),
                                patientId,
                                drugName: drug.name,
                                dosage: drug.dosage,
                                motivation: cond.title,
                                status: 'active',
                                startDate: randomDate(new Date(2023, 0, 1), new Date()),
                                createdAt: new Date()
                            });
                        }
                    }
                }
            }

            // 4. Generate Clinical Entries (Diary) & PDFs
            if (includeEntries) {
                const entryCount = randomInt(5, 15); // Rich history
                for (let j = 0; j < entryCount; j++) {
                    const date = randomDate(new Date(2025, 0, 1), new Date());
                    const type = randomFrom(['visit', 'phone', 'exam', 'note', 'scale'] as const);
                    const entryId = uuidv4();

                    let title = "";
                    let content = "";

                    if (type === 'visit') {
                        title = "Visita di Controllo";
                        content = "Paziente valutato in ambulatorio. Parametri vitali stabili.";
                        if (activeConditions.length > 0) {
                            const cond = randomFrom(activeConditions);
                            content += ` Controllo per ${cond.title}. Sintomi riferiti: ${randomFrom(cond.symptoms)}.`;
                        }
                    } else if (type === 'phone') {
                        title = "Contatto Telefonico";
                        content = "Colloquio con paziente/caregiver per aggiornamento terapia.";
                    } else if (type === 'note') {
                        title = "Nota Clinica";
                        content = "Osservazione clinica. Parametri stabili, il paziente riferisce benessere generale.";
                    } else if (type === 'exam') {
                        title = "Esami Strumentali";
                        content = "Visionati referti esami recenti.";

                        // Generate PDF Attachment
                        const pdfBlob = await generatePDF(Math.random() > 0.5 ? 'Esami Ematici' : 'Visita Specialistica', `${firstName} ${lastName}`, date);

                        // Convert Blob to Base64 for storage
                        const reader = new FileReader();
                        const base64data = await new Promise<string>((resolve) => {
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(pdfBlob);
                        });

                        const attachmentId = uuidv4();

                        await db.attachments.add({
                            id: attachmentId,
                            patientId,
                            name: `Referto_${date.toLocaleDateString().replace(/\//g, '-')}.pdf`,
                            path: "generated_via_seeder.pdf",
                            type: 'application/pdf',
                            size: pdfBlob.size,
                            data: base64data,
                            createdAt: date
                        });
                        content += ` [Allegato generato: Referto PDF]`;
                    } else if (type === 'scale') {
                        title = "Valutazione Multidimensionale";
                        content = "Somministrazione scale di valutazione.";

                        // Add checkup data
                        const scaleType = randomFrom(['adl', 'iadl', 'tinetti'] as const);
                        let score = 0, max = 0;
                        if (scaleType === 'adl') { score = randomInt(2, 6); max = 6; }
                        if (scaleType === 'iadl') { score = randomInt(3, 8); max = 8; }
                        if (scaleType === 'tinetti') { score = randomInt(10, 28); max = 28; }

                        content += ` Scala ${scaleType.toUpperCase()}: ${score}/${max}.`;

                        await db.checkups.add({
                            id: uuidv4(),
                            patientId,
                            date,
                            type: scaleType,
                            title: `Valutazione ${scaleType.toUpperCase()}`,
                            value: score,
                            maxValue: max,
                            notes: "Valutazione periodica",
                            createdAt: date
                        });
                    }

                    await db.entries.add({
                        id: entryId,
                        patientId,
                        type,
                        date,
                        title,
                        content,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        } catch (innerError) {
            console.error(`Seeder: Error generating patient ${i}`, innerError);
            throw innerError;
        }

        if (onProgress) onProgress(i + 1, patientCount);

        // Anti-overload delay
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`✅ Ecosystem seeding complete.`);
    return { count: patientCount };
}

// --- Nuke Function ---

export async function nukeTestData(full: boolean = false): Promise<{ deleted: number }> {
    console.log(`☢️ Nuking data (Full Mode: ${full})...`);

    let deletedCount = 0;

    if (full) {
        // Delete EVERYTHING
        const patients = await db.patients.toArray();
        deletedCount = patients.length;

        // Parallel nuke of all tables
        // Note: For API tables, we might need bulkDelete or iterative
        // Using iterative for safety as per existing pattern

        await db.entries.clear();
        await db.therapies.clear();
        await db.checkups.clear();
        await db.attachments.clear();
        await db.patients.clear();
        await db.conversations.clear();
        await db.messages.clear();

    } else {
        // Delete Only TEST- patients
        const allPatients = await db.patients.toArray();
        const testPatients = allPatients.filter(p => p.taxCode?.startsWith('TEST'));
        const testPatientIds = new Set(testPatients.map(p => p.id));

        if (testPatientIds.size > 0) {
            // 1. Delete Patients
            for (const p of testPatients) {
                await db.patients.delete(p.id);
            }
            deletedCount = testPatients.length;

            // 2. Cleanup Orphans (Client-side filtering strategy)
            console.log("Seeder: Cleaning up orphans...");

            const cleanupTable = async (table: any, tableName: string) => {
                try {
                    const items = await table.toArray();
                    const toDelete = items.filter((item: any) => testPatientIds.has(item.patientId));
                    for (const item of toDelete) {
                        await table.delete(item.id);
                    }
                    console.log(`Cleaned ${toDelete.length} orphans from ${tableName}`);
                } catch (e) {
                    console.error(`Failed to cleanup ${tableName}`, e);
                }
            };

            await Promise.all([
                cleanupTable(db.entries, 'entries'),
                cleanupTable(db.therapies, 'therapies'),
                cleanupTable(db.checkups, 'checkups'),
                cleanupTable(db.attachments, 'attachments'),
                cleanupTable(db.conversations, 'conversations') // Assuming conversations might link to patients? Check schema. 
                // schema says conversations don't have patientId directly, usually messages do or it's inferred. 
                // Let's stick to clinical data.
            ]);
        }
    }

    console.log(`🔥 Nuked ${deletedCount} patients and related data.`);
    return { deleted: deletedCount };
}
