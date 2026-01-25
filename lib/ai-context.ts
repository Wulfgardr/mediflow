import { db } from '@/lib/db';
import { calculateAge, estimateBirthYearFromTaxCode } from '@/lib/utils'; // Ensure these are exported from utils

export interface PatientContext {
    summary: string;
    found: boolean;
    patientName?: string;
}

/**
 * Builds a text context for a specific patient ID.
 * Fetches: Profile, Recent Diary Entries, Active Therapies, Recent Attachments.
 */
export async function buildPatientContext(patientId: string): Promise<string> {
    const patient = await db.patients.get(patientId);
    if (!patient) return "";

    // Calculate Age
    let age = "N/A";
    if (patient.birthDate) {
        age = (new Date().getFullYear() - new Date(patient.birthDate).getFullYear()).toString();
    } else if (patient.taxCode) {
        const estYear = estimateBirthYearFromTaxCode(patient.taxCode);
        if (estYear) age = calculateAge(estYear).toString();
    }

    // 1. Fetch Latest Clinical Entries (Diary)
    // 1. Fetch Latest Clinical Entries (Diary)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allEntries = await db.entries.filter((e: any) => e.patientId === patient.id).toArray();
    const entries = allEntries
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);

    const diaryContext = entries
        .map(e => `[${e.date.toLocaleDateString()}] ${e.type.toUpperCase()}: ${e.content}`)
        .join("\n");

    // 2. Fetch Active Therapies
    const therapies = await db.therapies
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((t: any) => t.patientId === patient.id && t.status === 'active')
        .toArray();

    const therapyContext = therapies
        .map(t => `- ${t.drugName} ${t.dosage}`)
        .join("\n");

    // 3. Fetch Recent Attachments (Summaries)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allAttachments = await db.attachments.filter((a: any) => a.patientId === patient.id).toArray();
    const attachments = allAttachments
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 3);

    const docsContext = attachments
        .filter(a => a.summarySnapshot)
        .map(a => `[DOC ${a.name}]: ${a.summarySnapshot}`)
        .join("\n");

    return `
--- CONTESTO PAZIENTE (ID: ${patient.id}) ---
DATIGRAFICI: ${patient.lastName} ${patient.firstName} (Età: ${age})
CF: ${patient.taxCode || 'N/A'}

[TERAPIA ATTIVA]
${therapyContext || "Nessuna terapia registrata."}

[STORIA CLINICA RECENTE (Ultime 5 note)]
${diaryContext || "Nessuna nota recente."}

[DOCUMENTI RECENTI]
${docsContext || "Nessun documento analizzato."}
--- FINE CONTESTO ---
Usa queste informazioni per rispondere alla richiesta dell'utente.
`;
}

/**
 * Smart Search: Tries to find a patient mentioned in the text.
 * Returns the generated context if a UNIQUE match is found.
 */
export async function findAndBuildSmartContext(text: string): Promise<PatientContext> {
    const allPatients = await db.patients.toArray();
    const cleanText = text.toLowerCase();

    // Split text into words to match against names
    // This is simple but effective for "Contini" or "Mario Rossi"
    const potentialMatches = allPatients.filter(p => {
        const fName = p.firstName.toLowerCase();
        const lName = p.lastName.toLowerCase();
        return cleanText.includes(lName) || cleanText.includes(fName + " " + lName) || cleanText.includes(lName + " " + fName);
    });

    // We accept a match if it's unique OR if we have a very strong match (Surname)
    // For safety, let's stick to unique matches to avoid leaking wrong data.
    if (potentialMatches.length === 1) {
        const ctx = await buildPatientContext(potentialMatches[0].id!);
        return {
            found: true,
            summary: ctx,
            patientName: `${potentialMatches[0].lastName} ${potentialMatches[0].firstName}`
        };
    }

    return { found: false, summary: "" };
}
