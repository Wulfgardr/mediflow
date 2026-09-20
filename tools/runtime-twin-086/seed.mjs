/* @Codex WUL-676: deterministic public fixtures through the existing web APIs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'tmp-086-twin/runtime.json'), 'utf8'));
assert.equal(receipt.synthetic, true);
assert(fs.existsSync(path.join(receipt.dataDir, 'SYNTHETIC-PROTOTYPE')));
assert(Number.isInteger(receipt.port) && receipt.port >= 3200 && receipt.port < 3400);
const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: `http://127.0.0.1:${receipt.port}` });
const now = new Date();
const existingIds = new Map();
function date(days, hour = 10) {
    const value = new Date(now);
    value.setDate(value.getDate() + days);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
}
async function write(route, data, method = 'POST') {
    if (method === 'POST' && existingIds.get(route)?.has(data.id)) return { id: data.id };
    return request(route, method, data);
}
async function request(route, method = 'GET', data) {
    // The real browser fetch wrapper owns the web authentication envelope.
    const response = await page.evaluate(async ({ route, method, data }) => {
        const result = await fetch(route, { method, headers: { 'Content-Type': 'application/json' },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { status: result.status, ok: result.ok, body: await result.json() };
    }, { route, method, data });
    assert(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
}
async function readablePdf(label) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sheet = doc.addPage([595, 842]);
    const lines = [
        'MEDIFLOW / DOCUMENTO SINTETICO', '', label,
        'Materiale dimostrativo. Nessun paziente reale.', '',
        'Visita di controllo - esempio per esplorare la cartella',
        'Data: ' + now.toLocaleDateString('it-IT'), '',
        'Rilevazioni dimostrative', 'Pressione arteriosa: 128/78 mmHg',
        'Frequenza cardiaca: 72 bpm', '',
        'Note', 'Documento di prova per apertura, ricerca ed estrazione locale.',
        'Non contiene una valutazione clinica o una prescrizione.', '',
        'Origine: fixture locale del prototipo 0.8.6. Nessuna firma.',
    ];
    lines.forEach((text, index) => sheet.drawText(text, { x: 44, y: 790 - index * 25, size: index === 0 ? 16 : 11, font, color: rgb(0.1, 0.12, 0.15) }));
    return Buffer.from(await doc.save());
}

try {
    await page.goto('/');
    assert.equal(await page.locator('html').getAttribute('data-runtime-twin'), 'true', 'Not a runtime twin');
    await page.getByLabel('PIN operatore').fill('086086');
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await page.getByRole('heading', { name: 'Sblocca MediFlow' }).waitFor({ state: 'hidden' });
    await page.getByTestId('lume-frame').waitFor({ state: 'visible' });
    const existing = await request('/api/patients');
    assert(Array.isArray(existing));
    assert(existing.every(patient => patient.id.startsWith('twin-086-')), 'Refusing to seed an unrelated caseload');
    const seedPath = path.join(root, 'tmp-086-twin/seed.json');
    if (fs.existsSync(seedPath)) {
        const previous = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        assert.notEqual(previous.dataDir, receipt.dataDir, 'Fixture already complete: preserve edits; start a fresh twin to reset');
    }
    // Resume a partial seed without overwriting any existing fixture or user edit.
    for (const collection of ['patients', 'therapies', 'entries', 'observations', 'checkups', 'attachments']) {
        const rows = collection === 'patients' ? existing : await request(`/api/${collection}`);
        existingIds.set(`/api/${collection}`, new Set(rows.map(row => row.id)));
    }

    for (let index = 1; index <= 6; index++) {
        const id = `twin-086-${String(index).padStart(2, '0')}`;
        const full = index <= 4;
        await write('/api/patients', {
            id, firstName: `Persona ${String(index).padStart(2, '0')}`, lastName: 'Sintetica',
            taxCode: `TWIN${String(index).padStart(12, '0')}`, birthDate: `${1940 + index * 8}-04-12T00:00:00.000Z`,
            address: 'Indirizzo dimostrativo', phone: '0000000000',
            caregiver: index === 2 ? 'Contatto dimostrativo - nessun recapito reale' : '',
            diagnoses: full ? [{ code: 'TEST-01', description: 'Condizione dimostrativa per revisione periodica', date: date(-60) }] : [],
            notes: full ? 'Cartella interamente sintetica. Controllo periodico, revisione delle terapie e follow-up. Nessuna indicazione clinica reale.' : 'Cartella sintetica con dati minimi, per esplorare gli stati vuoti.',
            isAdi: index === 2,
        });
        if (!full) continue;
        for (let ordinal = 0; ordinal < 2; ordinal++) {
            await write('/api/therapies', { id: `${id}-therapy-${ordinal}`, patientId: id,
                drugName: `Terapia dimostrativa ${ordinal + 1}`, activePrinciple: 'Principio dimostrativo',
                dosage: ordinal === 0 ? '1 unità al mattino · esempio' : '1 unità la sera · esempio',
                motivation: 'Scenario sintetico di revisione terapeutica',
                status: index === 3 && ordinal === 1 ? 'suspended' : 'active', startDate: date(-45),
            });
        }
        for (let ordinal = 0; ordinal < 3; ordinal++) {
            await write('/api/entries', { id: `${id}-entry-${ordinal}`, patientId: id,
                type: ['visit', 'phone', 'note'][ordinal], date: date(-ordinal * 7, 9 + index),
                title: ['Controllo periodico sintetico', 'Contatto telefonico dimostrativo', 'Piano di follow-up sintetico'][ordinal],
                content: '<p>Voce dimostrativa della cartella. Rivedere documenti e terapie durante il prossimo controllo.</p><p>Nessun dato reale, nessuna decisione clinica.</p>',
                setting: 'ambulatory',
            });
            await write('/api/observations', { id: `${id}-observation-${ordinal}`, patientId: id,
                codeSystem: 'LOINC', code: ['8867-4', '8310-5', '29463-7'][ordinal],
                display: ['Frequenza cardiaca', 'Temperatura corporea', 'Peso corporeo'][ordinal],
                unitSystem: 'UCUM', unitCode: ['/min', 'Cel', 'kg'][ordinal],
                value: ['72', '36.5', '68'][ordinal], observedAt: date(-ordinal * 7),
                notes: 'Misura sintetica per il prototipo', source: 'manual',
            });
        }
        for (let ordinal = 0; ordinal < 3; ordinal++) {
            await write('/api/checkups', { id: `${id}-checkup-${ordinal}`, patientId: id,
                date: date([0, 7, -3][ordinal], 8 + index),
                title: ['Visita di controllo · demo', 'Revisione documenti · demo', 'Follow-up precedente · demo'][ordinal],
                status: ordinal === 2 && index === 1 ? 'completed' : 'pending',
                notes: 'Appuntamento sintetico: nessun invito o calendario esterno.', source: 'manual',
            });
        }
        const name = `${id}-documento-sintetico.pdf`;
        const pdf = await readablePdf(`Persona sintetica ${index}`);
        await write('/api/attachments', { id: `${id}-document`, patientId: id, name,
            type: 'application/pdf', size: pdf.length, path: `uploads/${name}`,
            data: `data:application/pdf;base64,${pdf.toString('base64')}`,
        });
    }
    const archived = await request('/api/patients/twin-086-05');
    if (!archived.isArchived) await write('/api/patients/twin-086-05', { version: archived.version, isArchived: true,
        archiveReason: 'Percorso dimostrativo concluso', archiveNote: 'Archivio sintetico del prototipo',
    }, 'PUT');
    const counts = {};
    for (const collection of ['patients', 'therapies', 'entries', 'observations', 'checkups', 'attachments']) {
        counts[collection] = (await request(`/api/${collection}`)).length;
    }
    fs.writeFileSync(path.join(root, 'tmp-086-twin/seed.json'), JSON.stringify({ synthetic: true, dataDir: receipt.dataDir, at: now.toISOString(), counts }, null, 2));
    console.log(JSON.stringify(counts));
} finally { await browser.close(); }
