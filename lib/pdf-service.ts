
// Client-side text parsing only - Extraction happens on server via API

export interface ExtractedPatientData {
    firstName?: string;
    lastName?: string;
    taxCode?: string;
    birthDate?: Date;
    address?: string;
    notes?: string;
    rawText: string;
}

export async function extractTextFromPdf(file: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/pdf-extract', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to extract text from PDF");
    }

    const data = await response.json();
    return data.text || "";
}


export function parsePatientData(text: string): ExtractedPatientData {
    const data: ExtractedPatientData = { rawText: text };

    // Clean text: remove excessive whitespace
    const cleanText = text.replace(/\s+/g, ' ');

    // 1. C.F.
    const cfRegex = /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/i;
    const cfMatch = cleanText.match(cfRegex);
    if (cfMatch) data.taxCode = cfMatch[0].toUpperCase();

    // 2. BIRTH DATE
    // 2. BIRTH DATE
    const dateKeywords = /(?:nato|nata|nascita)\s+(?:il|a)?\s*[:\.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i;
    const dateMatch = cleanText.match(dateKeywords);
    if (dateMatch) {
        const [, dateStr] = dateMatch;
        const parts = dateStr.split(/[\/\-\.]/);
        if (parts.length === 3) data.birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    } else {
        const dateRegex = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/;
        const fallbackDate = cleanText.match(dateRegex);
        if (fallbackDate) {
            const [, d, m, y] = fallbackDate;
            data.birthDate = new Date(`${y}-${m}-${d}`);
        }
    }

    // 3. NAME
    const nameRegex = /(?:nome)\s*[:\.]?\s*([a-zA-Z\s]+)/i;
    const surnameMatch = cleanText.match(/(?:cognome)\s*[:\.]?\s*([a-zA-Z\s]+)/i);
    const patientMatch = cleanText.match(/(?:paziente|sig|sig\.ra)\s*[:\.]?\s*([a-zA-Z\s]+)/i);

    const matchName = cleanText.match(nameRegex);

    if (matchName && surnameMatch) {
        data.firstName = matchName[1].trim();
        data.lastName = surnameMatch[1].trim();
    } else if (patientMatch) {
        const parts = patientMatch[1].trim().split(/\s+/);
        if (parts.length >= 2) {
            data.lastName = parts[0];
            data.firstName = parts.slice(1).join(' ');
        }
    }

    // 4. NOTES / DIAGNOSIS (Improved with Context Window)
    // Keywords to start capture
    const startKeywords = ['diagnosi', 'motivo', 'anamnesi', 'storia', 'problema', 'conclusioni', 'valutazione', 'quesito'];
    // Keywords to stop capture (next section headers)
    const stopKeywords = ['terapia', 'prossimo', 'data', 'firma', 'cordiali', 'referto', 'medico'];

    // Find the first occurrence of a start keyword
    let bestIndex = -1;
    for (const kw of startKeywords) {
        const idx = cleanText.toLowerCase().indexOf(kw);
        // We want the earliest occurrence that isn't at the very start (avoid false positives if doc ID matches?)
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
        }
    }

    if (bestIndex !== -1) {
        // Capture up to 400 chars or until a stop keyword
        const maxLen = 400;
        let snippet = cleanText.substring(bestIndex, bestIndex + maxLen);

        // Try to trim the start (remove "Diagnosi:")
        const colonIdx = snippet.indexOf(':');
        if (colonIdx !== -1 && colonIdx < 20) {
            snippet = snippet.substring(colonIdx + 1);
        }

        // Try to cut off at stop keywords
        let cutIndex = snippet.length;
        for (const stopKw of stopKeywords) {
            const idx = snippet.toLowerCase().indexOf(stopKw);
            if (idx !== -1 && idx < cutIndex) {
                cutIndex = idx;
            }
        }

        data.notes = snippet.substring(0, cutIndex).trim();

        // Cleanup if it starts with "1." or similar list markers but keeps going
        if (data.notes.length > 5) {
            // It's a valid extract
        } else {
            data.notes = undefined; // Too short to be useful
        }
    }

    return data;
}
