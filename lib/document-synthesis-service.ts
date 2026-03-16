/**
 * Document Synthesis Service
 * Cross-collaboration: DeepSeek-OCR for extraction → MedGemma for clinical synthesis
 */

import { AIService } from './ai-service';
import { db, DocumentInsight } from './db';
import { v4 as uuid } from 'uuid';

const SYNTHESIS_PROMPT = `Sei un assistente clinico. Analizza questo documento medico scannerizzato e crea un RIASSUNTO CLINICO CONCISO.

FORMATO RICHIESTO:
**Tipo Documento:** [referto, lettera, esame, ricetta, altro]

**Dati Principali:**
- [punto 1]
- [punto 2]
- [punto 3]

**Note Cliniche:** [una frase riassuntiva]

REGOLE:
- Massimo 5 punti
- Non ripetere informazioni identitarie (nome, CF)
- Evidenzia diagnosi, valori, farmaci
- Sii breve ma esaustivo

DOCUMENTO:
`;

/* @Codex */
const MAX_SYNTHESIS_CHARS = 8000;

/* @Codex */
function smartSliceText(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;

    const keywords = [
        'diagnosi', 'terapia', 'farmac', 'prescr', 'anamnesi', 'esami', 'referto',
        'dimission', 'valutazione', 'conclusioni', 'paziente', 'medico', 'allergie'
    ];

    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const scored = lines.map((line, index) => {
        const lower = line.toLowerCase();
        let score = lower.length;
        for (const keyword of keywords) {
            if (lower.includes(keyword)) score += 500;
        }
        if (/\d{1,3}[,\.]\d+/.test(lower)) score += 200;
        return { line, score, index };
    });

    scored.sort((a, b) => b.score - a.score);

    const picked: string[] = [];
    let total = 0;

    for (const item of scored) {
        if (total + item.line.length + 1 > maxChars) continue;
        picked.push(item.line);
        total += item.line.length + 1;
        if (total >= maxChars) break;
    }

    if (total < maxChars * 0.4) {
        const head = text.slice(0, Math.floor(maxChars * 0.5));
        const tail = text.slice(-Math.floor(maxChars * 0.3));
        return `${head}\n...\n${tail}`;
    }

    return picked.join('\n');
}

/**
 * Synthesize a document using cross-collaboration between OCR and Clinical models
 * @param rawMarkdown - The extracted text from DeepSeek-OCR
 * @param fileName - Original file name for reference
 * @param patientId - Patient to attach the insight to
 * @returns The created DocumentInsight
 */
export async function synthesizeDocument(
    rawMarkdown: string,
    fileName: string,
    patientId: string
): Promise<DocumentInsight> {
    // Use MedGemma (clinical) for synthesis
    const ai = await AIService.create('clinical');

    /* @Codex */
    const sliced = smartSliceText(rawMarkdown, MAX_SYNTHESIS_CHARS);
    const prompt = SYNTHESIS_PROMPT + sliced;

    const content = await ai.generate(prompt, undefined, 768);

    // Clean thinking tokens if present
    let cleanContent = content
        .replace(/<unused94>[\s\S]*?(<unused95>|$)/, '')
        .replace(/^Plan:\s*/i, '')
        .trim();

    if (!cleanContent) {
        cleanContent = "Documento scannerizzato. Riassunto non disponibile.";
    }

    // Create the insight object
    const insight: DocumentInsight = {
        id: uuid(),
        date: new Date(),
        fileName,
        rawMarkdown: rawMarkdown.substring(0, 3000), // Store truncated raw
        summary: cleanContent
    };

    // Fetch current patient and update with new insight
    const patient = await db.patients.get(patientId);
    if (!patient) {
        throw new Error("Paziente non trovato");
    }

    // Parse existing insights or initialize empty array
    let existingInsights: DocumentInsight[] = [];
    if (patient.documentInsights) {
        existingInsights = typeof patient.documentInsights === 'string'
            ? JSON.parse(patient.documentInsights)
            : patient.documentInsights;
    }

    // Add new insight at the beginning, keep only last 3
    existingInsights.unshift(insight);
    if (existingInsights.length > 3) {
        existingInsights = existingInsights.slice(0, 3);
    }

    // Save back to patient
    await db.patients.update(patientId, {
        documentInsights: existingInsights,
        version: patient.version,
        updatedAt: new Date()
    });

    return insight;
}

/**
 * Get document insights for a patient
 */
export async function getDocumentInsights(patientId: string): Promise<DocumentInsight[]> {
    const patient = await db.patients.get(patientId);
    if (!patient?.documentInsights) return [];

    return typeof patient.documentInsights === 'string'
        ? JSON.parse(patient.documentInsights)
        : patient.documentInsights;
}
