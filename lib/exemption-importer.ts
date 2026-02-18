/* @Codex */
import { db, ExemptionCode } from './db';

type ProgressCallback = (processed: number, total: number) => void;

type ImportSummary = {
    imported: number;
    processedLines: number;
    files: number;
};

function cleanValue(value: string | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed || trimmed === '\\N') return '';
    return trimmed;
}

function parseCompactDate(value: string): Date | null {
    if (!/^\d{8}$/.test(value)) return null;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseFlag(value: string): boolean | undefined {
    if (!value) return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'S' || normalized === 'Y' || normalized === 'TRUE' || normalized === '1') return true;
    if (normalized === 'N' || normalized === 'FALSE' || normalized === '0') return false;
    return undefined;
}

function isActive(record: ExemptionCode, now: Date): boolean {
    if (!record.endDate) return true;
    return new Date(record.endDate).getTime() >= now.getTime();
}

function shouldReplace(current: ExemptionCode, candidate: ExemptionCode, now: Date): boolean {
    const currentActive = isActive(current, now);
    const candidateActive = isActive(candidate, now);

    if (currentActive !== candidateActive) return candidateActive;

    const currentStart = current.startDate ? new Date(current.startDate).getTime() : 0;
    const candidateStart = candidate.startDate ? new Date(candidate.startDate).getTime() : 0;
    if (currentStart !== candidateStart) return candidateStart > currentStart;

    return candidate.description.length > current.description.length;
}

function parseFile(text: string, source: string): ExemptionCode[] {
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return [];

    const header = lines[0].split('|').map((col) => col.trim().toUpperCase());
    const idx = {
        code: header.indexOf('CD_ESENZIONE'),
        description: header.indexOf('DS_ESENZIONE'),
        type: header.indexOf('CD_TIPO_ESENZIONE'),
        startDate: header.indexOf('DT_INIZIO_VALIDITA'),
        endDate: header.indexOf('DT_FINE_VALIDITA'),
        pharma: header.indexOf('FL_AMBITO_FARMACEUTICO'),
        specialist: header.indexOf('FL_AMBITO_SPECIALISTICO'),
        national: header.indexOf('FL_NAZIONALE'),
    };

    if (idx.code < 0 || idx.description < 0) return [];

    const parsed: ExemptionCode[] = [];
    for (let i = 1; i < lines.length; i += 1) {
        const row = lines[i].trim();
        if (!row) continue;

        const cols = row.split('|');
        const code = cleanValue(cols[idx.code]).toUpperCase();
        const description = cleanValue(cols[idx.description]);
        if (!code || !description) continue;

        const startDateRaw = idx.startDate >= 0 ? cleanValue(cols[idx.startDate]) : '';
        const endDateRaw = idx.endDate >= 0 ? cleanValue(cols[idx.endDate]) : '';

        parsed.push({
            code,
            description,
            type: idx.type >= 0 ? cleanValue(cols[idx.type]) : undefined,
            source,
            startDate: parseCompactDate(startDateRaw) || undefined,
            endDate: parseCompactDate(endDateRaw) || undefined,
            isPharma: idx.pharma >= 0 ? parseFlag(cleanValue(cols[idx.pharma])) : undefined,
            isSpecialist: idx.specialist >= 0 ? parseFlag(cleanValue(cols[idx.specialist])) : undefined,
            isNational: idx.national >= 0 ? parseFlag(cleanValue(cols[idx.national])) : undefined,
            updatedAt: new Date(),
        });
    }

    return parsed;
}

export async function importExemptionFiles(files: File[], onProgress?: ProgressCallback): Promise<ImportSummary> {
    if (!files.length) {
        return { imported: 0, processedLines: 0, files: 0 };
    }

    const merged = new Map<string, ExemptionCode>();
    const now = new Date();

    let processedLines = 0;
    let totalLines = 0;

    for (const file of files) {
        const content = await file.text();
        const parsed = parseFile(content, file.name);
        totalLines += parsed.length;
        for (const candidate of parsed) {
            processedLines += 1;
            const existing = merged.get(candidate.code);
            if (!existing || shouldReplace(existing, candidate, now)) {
                merged.set(candidate.code, candidate);
            }
            if (onProgress && processedLines % 100 === 0) {
                onProgress(processedLines, Math.max(totalLines, processedLines));
            }
        }
    }

    const records = Array.from(merged.values());
    const batchSize = 60;
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await db.exemptions.bulkPut(batch);
    }

    if (onProgress) {
        onProgress(processedLines, Math.max(totalLines, processedLines));
    }

    return {
        imported: records.length,
        processedLines,
        files: files.length,
    };
}

export async function clearExemptionDatabase() {
    return db.exemptions.clear();
}

export async function getExemptionStats(): Promise<number> {
    const response = await fetch('/api/exemptions?count=1');
    if (!response.ok) throw new Error('Failed to fetch exemption stats');
    const payload = await response.json();
    return Number(payload.count || 0);
}
