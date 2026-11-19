import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { encryptData } from '../../lib/security/security';

export async function createConceptPatient(page: Page) {
    const archive = process.env.MEDIFLOW_DATA_DIR;
    const host = new URL(page.url());
    if (!archive || process.env.MF085_SYNTHETIC_E2E !== '1' || host.hostname !== '127.0.0.1' || !host.port || host.port === '3000') {
        throw new Error('La cartella dimostrativa richiede un archivio sintetico isolato.');
    }
    const jwk = await page.evaluate(() => {
        const session = JSON.parse(sessionStorage.getItem('mediflow_session_key') ?? 'null');
        if (!session) throw new Error('Sbloccare la sessione sintetica.');
        return (session.jwk ?? session) as JsonWebKey;
    });
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, false, ['encrypt']);
    async function seal(value: unknown) {
        const { iv, data } = await encryptData(value, key);
        return `ENC:${iv}:${data}`;
    }
    async function post(entity: string, body: Record<string, unknown>) {
        return page.evaluate(async ({ entity, body }) => {
            const response = await fetch(`/api/${entity}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`Cartella dimostrativa, ${entity}: ${response.status}`);
            return (await response.json() as { id: string }).id;
        }, { entity, body });
    }
    const stamp = (days: number, hour = 12) => {
        const date = new Date();
        date.setDate(date.getDate() - days);
        date.setHours(hour, 0, 0, 0);
        return date;
    };
    const diagnoses = [
        { code: 'I50.9', description: 'Scompenso cardiaco', date: '2019-09-03' },
        { code: 'I48.91', description: 'Fibrillazione atriale', date: '2020-02-14' },
        { code: 'E11.9', description: 'Diabete mellito tipo 2', date: '2018-03-28' },
        { code: 'N18.3', description: 'Malattia renale cronica', date: '2023-11-09' },
    ].map(item => ({ ...item, system: 'ICD-10' }));
    const patientId = await post('patients', {
        firstName: 'Bianca', lastName: 'Sintetica', taxCode: 'SNTBNC47H52Z000K', birthDate: '1947-06-12',
        isAdi: true, diagnoses: await seal(diagnoses), exemptions: await seal(['013', '021']),
        allergies: await seal([{ substance: 'penicillina' }]),
    });
    const entries: { id: string; day: number; hour: number; author: string }[] = [];
    for (const [day, hour, type, author, title, content] of [
        [15, 9, 'visit', 'Dott. Sintetico', 'Visita ambulatoriale', 'Rilevati i parametri per il controllo successivo.'],
        [7, 10, 'access', 'Inf. Sintetica', 'Nota ADI', 'Edemi declivi. Peso 71,4 kg. Concordato il prossimo accesso.'],
        [7, 16, 'phone', 'Dott.ssa Prova', 'Telefonata', 'Potassio 5,6. Sospeso spironolattone. Ricontrollo elettroliti tra 7 giorni.'],
    ] as const) {
        const id = await post('entries', { patientId, type, date: stamp(day, hour), title: await seal(title), content: await seal(content) });
        entries.push({ id, day, hour, author });
    }
    const therapies: { id: string; day: number; updated: boolean }[] = [];
    for (const [drugName, dosage, status, updated] of [
        ['Furosemide 25 mg cpr', '1 cp ore 8 · ½ cp ore 14', 'active', true],
        ['Apixaban 5 mg cpr', '1 cp ogni 12 ore', 'active', false],
        ['Bisoprololo 2,5 mg cpr', '1 cp al mattino', 'active', false],
        ['Metformina 500 mg cpr', '1 cp a pranzo e cena', 'active', false],
        ['Spironolattone 25 mg cpr', '1 cp al mattino', 'suspended', true],
    ] as const) {
        const id = await post('therapies', { patientId, drugName, dosage, status, startDate: stamp(130),
            ...(status === 'suspended' ? { motivation: await seal('Potassio 5,6 mmol/L') } : {}) });
        therapies.push({ id, day: updated ? 7 : 130, updated });
    }
    const measures: { id: string; day: number }[] = [];
    for (const [code, display, unitCode, earlier, recent, refHigh] of [
        ['2823-3', 'Potassio', 'mmol/L', 4.7, 5.6, '5.1'],
        ['2160-0', 'Creatinina', 'mg/dL', 1.21, 1.32, null],
        ['29463-7', 'Peso', 'kg', 70.2, 71.4, null],
    ] as const) {
        for (const [day, value] of [[22, earlier], [9, recent]] as const) {
            const id = await post('observations', { patientId, codeSystem: 'LOINC', code, display, unitCode, unitSystem: 'UCUM',
                value, observedAt: stamp(day), source: 'manual', ...(refHigh ? { refHigh } : {}) });
            measures.push({ id, day });
        }
    }
    const db = new Database(join(archive, 'medical.db'), { fileMustExist: true });
    const at = (day: number, hour?: number) => stamp(day, hour).getTime() / 1000;
    try {
        db.transaction(() => {
            for (const row of entries) db.prepare('UPDATE entries SET created_at=?, updated_at=?, recorded_by=? WHERE id=? AND patient_id=?')
                .run(at(row.day, row.hour), at(row.day, row.hour), row.author, row.id, patientId);
            for (const row of therapies) db.prepare('UPDATE therapies SET created_at=?, updated_at=?, version=? WHERE id=? AND patient_id=?')
                .run(at(130), at(row.day), row.updated ? 2 : 1, row.id, patientId);
            for (const row of measures) db.prepare('UPDATE observations SET created_at=? WHERE id=? AND patient_id=?').run(at(row.day), row.id, patientId);
        })();
    } finally { db.close(); }
    return patientId;
}
