import { db, AifaDrug } from './db';

/**
 * Parses a standard AIFA Open Data CSV line.
 * Assumed Format (Common AIFA Layout):
 * AIC;Denominazione;Ditta;Principio Attivo;Prezzo;Tipo;Gruppo Equivalenza;Fascia
 * 
 * Note: Real AIFA CSVs can vary. This parser supports the "Lista Farmaci Classe A/H" standard layout.
 */
export async function importAifaCsv(file: File, onProgress?: (count: number, total: number) => void): Promise<number> {
    const text = await file.text();
    const lines = text.split('\n');
    const batchSize = 2000; // Optimal batch size for IndexedDB
    let processed = 0;
    const total = lines.length;

    // Detect header to map columns dynamically (Simple implementation checks for known headers)
    // For this MVP we assume a standard layout or try to detect position
    const header = lines[0].toLowerCase();
    const isSemicolon = header.includes(';');
    const separator = isSemicolon ? ';' : ',';

    const drugsBuffer: AifaDrug[] = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(separator).map(c => c.replace(/^"|"$/g, '').trim()); // Remove quotes

        // confezioni.csv mapping:
        // 0: codice_aic
        // 3: denominazione
        // 4: descrizione (packaging)
        // 6: ragione_sociale
        // 10: codice_atc
        // 11: pa_associati

        if (cols.length < 12) continue; // Basic length check for this file format

        const aic = cols[0]?.trim();
        const name = cols[3]?.trim();
        const packaging = cols[4]?.trim();
        const company = cols[6]?.trim();
        const atc = cols[10]?.trim();
        const activePrinciple = cols[11]?.trim();

        if (!aic || aic.length < 6 || !name) continue;

        try {
            const drug: AifaDrug = {
                aic,
                name,
                company: company || '',
                activePrinciple: activePrinciple || '',
                packaging: packaging || '',
                atc: atc || '',
                updatedAt: new Date()
            };

            drugsBuffer.push(drug);
        } catch (e) {
            console.warn("Skipping invalid line", i, line, e);
        }

        if (drugsBuffer.length >= batchSize) {
            await db.drugs.bulkPut(drugsBuffer);
            processed += drugsBuffer.length;
            drugsBuffer.length = 0; // Clear buffer
            if (onProgress) onProgress(processed, total);
        }
    }

    // Flush remaining
    if (drugsBuffer.length > 0) {
        await db.drugs.bulkPut(drugsBuffer);
        processed += drugsBuffer.length;
        if (onProgress) onProgress(processed, total);
    }

    return processed;
}

export async function clearDrugDatabase() {
    return await db.drugs.clear();
}

export async function getDrugStats() {
    // Optimize: Don't download all DB just to count
    // Use the optimized API route if available, or just fallback
    // For now we rely on the implementation in db.ts
    return await db.drugs.count();
}
