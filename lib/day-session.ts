import { z } from 'zod';
import { isValidItalianTaxCode } from './patient-identity';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;
const visitPattern = /^V\d{2,}$/u;
const sessionPattern = /^S\d{2,}$/u;
const stamp = z.number().min(1).max(253402300799);
const code = z.string().regex(/^[A-Z0-9]{4,16}$/u);
const thirdState = z.enum(['aperto', 'proposto', 'confermato', 'pertinente', 'ripristinato', 'scartato']);
const third = z.object({ id: z.string().regex(/^T\d{2,}$/u), stato: thirdState, inizio_epoch: stamp.nullish(), fine_epoch: stamp.nullish() });
const manifest = z.object({
    versione: z.union([z.literal(1), z.literal(2)]), visita: z.string().regex(visitPattern), seduta: z.string().regex(sessionPattern).optional(),
    tratto: z.number().int().positive().optional(), stato: z.string().max(80),
    aperta_epoch: stamp, chiusa_epoch: stamp.nullish(), pdf_da_epoch: stamp.nullish(), pdf_a_epoch: stamp.nullish(), cf: z.string().max(32).nullish(),
    cf_dettato_parziale: code.nullish(), inserita: z.boolean().optional(), unita_in: z.string().nullish(),
    deposito_agente: z.object({ stato: z.string().optional() }).nullish(),
    tratti_terzi: z.array(third).max(128).default([]),
    pdf: z.array(z.object({
        origine: z.string().max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(), mtime: stamp,
        esito: z.string().max(80), promemoria: z.boolean().optional(),
        cf_presenti: z.array(z.string().max(32)).max(128).default([]), cf_medico: z.array(z.string().max(32)).max(128).default([]),
    })).max(256).default([]),
});
const session = z.object({ seduta: z.string().regex(sessionPattern), tratti_terzi: z.array(third).max(128).default([]) });
const document = z.object({ name: z.string().min(1).max(4096), at: stamp, hash: z.string().optional(), receipt: z.boolean(), codes: z.array(code), assigned: z.boolean(), nearby: z.boolean() });
const entry = z.object({
    id: z.string().min(1).max(160), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), source: z.string().min(1).max(100),
    day: z.string().regex(dayPattern), at: stamp.nullable(), end: stamp.nullable(), text: z.string().max(60000),
    fragment: code.nullable(), documents: z.array(document), type: z.enum(['pending', 'visit', 'third']),
    decision: z.discriminatedUnion('kind', [z.object({ kind: z.literal('discarded') }),
        z.object({ kind: z.literal('linked'), patientId: z.string().min(1).max(128) })]).nullable(),
});
export const daySessionEntriesSchema = z.array(entry).max(1000);
export type DaySessionEntry = z.infer<typeof entry>;
export type DaySessionDecision = NonNullable<DaySessionEntry['decision']>;

const encoder = new TextEncoder();
async function sourceEntry(value: Omit<DaySessionEntry, 'fingerprint' | 'decision'>): Promise<DaySessionEntry> {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return entry.parse({ ...value, fingerprint, decision: null });
}

async function readText(file: File, maximum: number) {
    if (file.size > maximum) throw new Error('Day session file exceeds limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
}

const activeThird = (value: z.infer<typeof third>) => !['scartato', 'ripristinato'].includes(value.stato);
function thirdEntries(day: string, owner: string, values: z.infer<typeof third>[]) {
    return values.filter(activeThird).map(value => sourceEntry({
        id: `${day}/${owner}/${value.id}`, source: `${owner} · ${value.id}`, day, at: value.inizio_epoch ?? null,
        end: null, text: '', fragment: null, documents: [], type: 'third',
    }));
}

export async function readDaySession(files: Iterable<File>): Promise<DaySessionEntry[]> {
    const sources = new Map<string, File>();
    let day = '';
    for (const file of files) {
        const match = /^ambulatorio-(\d{4})(\d{2})(\d{2})\/((?:V|S)\d{2,})\/(manifest\.json|trascrizione\.txt|seduta\.json)$/u.exec(file.webkitRelativePath);
        if (!match) continue;
        const [, year, month, date, folder, name] = match;
        const sourceDay = `${year}-${month}-${date}`;
        const calendar = new Date(`${sourceDay}T00:00:00Z`);
        if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== sourceDay || day && day !== sourceDay) throw new Error('Invalid session day');
        day = sourceDay;
        const key = `${folder}/${name}`;
        if (sources.has(key) || sources.size >= 600) throw new Error('Invalid session sources');
        sources.set(key, file);
    }
    const entries: DaySessionEntry[] = [];
    const sessionThirds = new Map<string, z.infer<typeof third>[]>();
    for (const [key, file] of sources) {
        const [folder, name] = key.split('/');
        if (!sessionPattern.test(folder) || name !== 'seduta.json') continue;
        const row = session.parse(JSON.parse(await readText(file, 1024 * 1024)));
        if (row.seduta !== folder) throw new Error('Session source mismatch');
        sessionThirds.set(folder, row.tratti_terzi.filter(activeThird));
        entries.push(...await Promise.all(thirdEntries(day, folder, row.tratti_terzi)));
    }
    for (const [key, file] of sources) {
        const [folder, name] = key.split('/');
        if (!visitPattern.test(folder) || name !== 'manifest.json') continue;
        const row = manifest.parse(JSON.parse(await readText(file, 1024 * 1024)));
        if (row.visita !== folder) throw new Error('Visit source mismatch');
        const end = row.chiusa_epoch;
        if (end == null || row.stato === 'annullata' || row.unita_in) continue;
        if (end < row.aperta_epoch) throw new Error('Invalid visit times');
        const thirds = thirdEntries(day, folder, row.tratti_terzi);
        const hasThird = thirds.length > 0 || (sessionThirds.get(row.seduta ?? '') ?? []).some(trait =>
            trait.inizio_epoch == null || (trait.inizio_epoch < end && (trait.fine_epoch ?? trait.inizio_epoch) >= row.aperta_epoch));
        const transcript = hasThird ? undefined : sources.get(`${folder}/trascrizione.txt`);
        const documents = row.pdf.filter(pdf => pdf.esito === 'candidato' || pdf.esito === 'accettato').map(pdf => ({
            name: pdf.origine.split(/[/\\]/u).at(-1) || 'PDF', at: pdf.mtime, hash: pdf.sha256, receipt: pdf.promemoria ?? false,
            codes: Array.from(new Set(pdf.cf_presenti.filter(cf => !pdf.cf_medico.includes(cf) && isValidItalianTaxCode(cf)))),
            assigned: pdf.esito === 'accettato',
            nearby: pdf.mtime >= (row.pdf_da_epoch ?? row.aperta_epoch) && pdf.mtime <= (row.pdf_a_epoch ?? end),
        }));
        entries.push(await sourceEntry({
            id: `${day}/${folder}`, day, source: row.seduta && row.tratto ? `${row.seduta} · Tratto ${row.tratto} · ${folder}` : folder,
            at: row.aperta_epoch, end, text: transcript ? await readText(transcript, 60000) : '',
            fragment: hasThird ? null : row.cf_dettato_parziale ?? null, documents,
            type: !row.cf && !row.inserita && !hasThird && !row.deposito_agente?.stato ? 'pending' : 'visit',
        }), ...await Promise.all(thirds));
    }
    if (!entries.length || new Set(entries.map(value => value.id)).size !== entries.length) throw new Error('Empty or duplicate session');
    return daySessionEntriesSchema.parse(entries);
}

type CandidatePatient = { id: string; firstName: string; lastName: string; taxCode: string; birthDate?: Date | null; isArchived?: boolean; deletedAt?: unknown };
const words = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\d]+/gu) ?? [];
const phrase = (value: string) => ` ${words(value).join(' ')} `;
const birthDates = (text: string) => new Set(Array.from(text.matchAll(/\bnat[oa]\s+il\s+(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}))\b/giu),
    ([, isoYear, isoMonth, isoDay, day, month, year]) => isoYear ? `${isoYear}-${isoMonth}-${isoDay}` : `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`));

export function daySessionCandidates<T extends CandidatePatient>(source: DaySessionEntry, patients: T[]) {
    if (source.type !== 'pending' || source.decision) return [];
    const text = phrase(source.text);
    const dates = birthDates(source.text);
    return patients.filter(patient => !patient.isArchived && !patient.deletedAt).flatMap(patient => {
        const first = words(patient.firstName).join(' '), last = words(patient.lastName).join(' ');
        const fullName = Boolean(first && last && (text.includes(` ${first} ${last} `) || text.includes(` ${last} ${first} `)));
        const firstName = !fullName && first.length >= 3 && [`paziente ${first}`, `visita ${first}`].some(name => text.includes(` ${name} `));
        const code = patient.taxCode.trim().toUpperCase();
        const valid = isValidItalianTaxCode(code);
        const fragment = Boolean(valid && source.fragment && code.startsWith(source.fragment));
        const nearPdf = valid && source.documents.some(pdf => pdf.nearby && pdf.codes.length === 1 && pdf.codes[0] === code);
        const birthDate = patient.birthDate && Number.isFinite(patient.birthDate.getTime()) ? patient.birthDate.toISOString().slice(0, 10) : null;
        if (dates.size && birthDate && !dates.has(birthDate)) return [];
        const birth = birthDate !== null && dates.has(birthDate);
        const evidence = [[fullName, 'Nome e cognome nel dettato', 4], [firstName, 'Nome nel dettato', 1],
            [fragment, 'Inizio del codice fiscale compatibile', 6], [nearPdf, 'Codice fiscale in un PDF vicino', 3], [birth, 'Data di nascita nel dettato', 2]] as const;
        const matched = evidence.filter(([found]) => found);
        return fullName || firstName || fragment || nearPdf ? [{ patient, reasons: matched.map(([, label]) => label), score: matched.reduce((score, [, , weight]) => score + weight, 0) }] : [];
    }).sort((a, b) => b.score - a.score || a.patient.lastName.localeCompare(b.patient.lastName, 'it')
        || a.patient.firstName.localeCompare(b.patient.firstName, 'it') || a.patient.id.localeCompare(b.patient.id));
}
