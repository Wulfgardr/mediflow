import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { serializeBackupArtifact } from '../lib/backup-artifact';
import { bootstrapUnlockedSession } from './utils';
import { loginWithWebAuthControl } from '../scripts/web-auth-control-test-client.mjs';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

test('comando terapia nativo, backup e importazione portabile conservano storico senza importare autorità', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const dir = process.env.MEDIFLOW_DATA_DIR;
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !dir || !isAbsolute(dir) || !baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
        test.skip(true, 'Richiede un server sintetico isolato.'); return;
    }
    const pin = process.env.E2E_PIN || '1234';
    await fetch(baseURL + '/api/auth/native/therapy-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await bootstrapUnlockedSession(page, pin);
    const headers = { ...await trustedArchiveWebRequestHeaders(page), 'Content-Type': 'application/json' };
    const db = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    const patientId = randomUUID(), therapyId = randomUUID(), forgedId = randomUUID();
    const actor = db.prepare('SELECT id FROM users WHERE username=?').get(process.env.E2E_USERNAME || 'admin') as { id: string };
    const scope = db.prepare('SELECT id FROM ambulatories LIMIT 1').get() as { id: string };
    async function call(path: string, body: unknown, extra: Record<string, string> = {}) {
        const r = await fetch(baseURL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
        const json = await r.json(); expect(r.status, JSON.stringify(json)).toBeLessThan(300);
        return { json, cookies: r.headers.getSetCookie() };
    }
    try {
        db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code) VALUES (?,?,?,?)').run(patientId, 'Persona', 'Sintetica U2', patientId);
        db.prepare('INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id) VALUES (?,?)').run(patientId, scope.id);
        db.prepare("INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date,version) VALUES (?,?,?,?,'active',unixepoch(),1)").run(therapyId, patientId, 'Farmaco sintetico', 'Dose sintetica');
        const mode = await page.request.put('/api/settings/network.mode', { headers, data: { value: 'network-home-base' } }); expect(mode.ok()).toBe(true);
        const intent = await call('/api/v1/network/pairing-intents', { deviceName: 'U2 sintetico', clientPlatform: 'macos', appVersion: '0.9.1', requestedCapabilities: ['network.replica.readonly-patients', 'network.replica.readonly-therapies', 'network.replica.write-therapies'] });
        if (!process.env.MEDIFLOW_LOCAL_API_TOKEN && !existsSync(join(dir, 'local-api-token'))) {
            const denied = await fetch(baseURL + `/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            expect(denied.status).toBe(401);
        }
        const localToken = process.env.MEDIFLOW_LOCAL_API_TOKEN || readFileSync(join(dir, 'local-api-token'), 'utf8').trim();
        const paired = await call(`/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, {}, { Authorization: `Bearer ${localToken}` });
        const peer = { 'x-mediflow-paired-client-id': paired.json.pairedClient.clientId, 'x-mediflow-paired-client-token': paired.json.pairedClientToken };
        const login = await call('/api/auth/native/login', { username: process.env.E2E_USERNAME || 'admin', password: pin }, peer);
        const native = { ...peer, Cookie: login.cookies.map(c => c.split(';')[0]).join('; ') + `; ambulatory_id=${scope.id}`, 'x-mediflow-archive-generation': login.json.archiveGeneration };
        const epoch = await (await fetch(baseURL + '/api/v1/network/patient-profile/selection-epoch', { headers: native })).json();
        const selection = await call(`/api/v1/network/patients/${patientId}/profile-query`, { kind: 'open', contractVersion: 1, projection: 'profile', expectedSelectionEpoch: epoch.selectionEpoch }, native);
        const selectionEpoch = selection.json.currentness.selectionEpoch;
        const open = await call('/api/auth/native/therapy-status', { operation: 'open', patientId, selectionEpoch }, native);
        const command = { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: login.json.archiveGeneration, patientId, therapyId, expectedVersion: 1, target: 'suspended' };
        await call('/api/auth/native/therapy-status', { operation: 'preview', command, viewId: open.json.viewId, selectionEpoch }, native);
        const execute = await call('/api/auth/native/therapy-status', { operation: 'execute', commandId: command.commandId, pin }, native);
        expect(execute.json.outcome).toBe('applied');
        const ledger = db.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId);
        const audit = db.prepare('SELECT * FROM audit_events WHERE request_id=?').get(command.commandId) as { source_surface: string };
        expect(audit.source_surface).toBe('native');
        const exported = await page.request.get('/api/system/backup-restore'); expect(exported.status()).toBe(200);
        const artifact = await exported.json();
        const verified = await page.request.post('/api/system/backup-restore/verify', { headers, data: artifact }); expect(verified.status()).toBe(200);
        artifact.payload.patients.find((p: { id: string }) => p.id === patientId).firstName = 'Importata sintetica';
        const now = Math.floor(Date.now() / 1000);
        artifact.payload.auditEvents.push({ eventId: forgedId, schemaVersion: 1, eventType: 'patient.updated', occurredAt: now, outcome: 'success', actorType: 'user', actorRef: actor.id, subjectType: 'patient', subjectRef: patientId, sourceSurface: 'web', requestId: null, redactedMetadata: null, createdAt: now });
        artifact.payload.physicianReviewAttestations = [{ actorRef: actor.id, schemaVersion: 'mediflow.physician-review-attestation.v1', capability: 'physician_terminal_review', status: 'active', attestationVersion: 1, policyVersion: 'physician_terminal_review.v1', revokedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
        const forgedCommandId = randomUUID(), forgedTherapyAuditId = randomUUID();
        const originalCommand = artifact.payload.therapyStatusCommands.find((row: { commandId: string }) => row.commandId === command.commandId);
        const forgedCommand = { ...originalCommand, commandId: forgedCommandId, auditEventId: forgedTherapyAuditId };
        const forgedTherapyAudit = { ...JSON.parse(originalCommand.auditSnapshot), eventId: forgedTherapyAuditId, requestId: forgedCommandId };
        forgedCommand.auditSnapshot = JSON.stringify(forgedTherapyAudit);
        artifact.payload.therapyStatusCommands.push(forgedCommand);
        artifact.payload.auditEvents.push(forgedTherapyAudit, ...Array.from({ length: 250 }, (_, index) => ({
            ...forgedTherapyAudit, eventId: `u2-flood-${randomUUID()}`, occurredAt: now + index + 1, requestId: null,
        })));
        const hostile = await serializeBackupArtifact(artifact.payload);
        for (const credential of [undefined, { pin: '99999999' }]) {
            const denied = await page.request.post('/api/system/backup-restore', { headers: { ...headers, ...(credential ? { 'x-mediflow-restore-credential': JSON.stringify(credential) } : {}) }, data: hostile });
            expect(denied.status(), await denied.text()).toBe(401);
            expect(db.prepare('SELECT first_name FROM patients WHERE id=?').get(patientId)).toEqual({ first_name: 'Persona' });
            expect(db.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId)).toEqual(ledger);
            expect(db.prepare('SELECT * FROM audit_events WHERE event_id=?').get(forgedId)).toBeUndefined();
        }
        const localHistory = db.prepare('SELECT * FROM audit_events').all() as { event_id: string }[];
        const restored = await page.request.post('/api/system/backup-restore', { headers: { ...headers, 'x-mediflow-restore-credential': JSON.stringify({ pin }) }, data: hostile });
        expect(restored.status(), await restored.text()).toBe(200);
        expect(db.prepare('SELECT first_name FROM patients WHERE id=?').get(patientId)).toEqual({ first_name: 'Importata sintetica' });
        expect(db.prepare('SELECT status FROM physician_review_attestations WHERE actor_ref=?').get(actor.id)).toEqual({ status: 'inactive' });
        expect(db.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId)).toEqual(ledger);
        expect(db.prepare('SELECT * FROM audit_events WHERE request_id=?').get(command.commandId)).toEqual(audit);
        for (const row of localHistory) expect(db.prepare('SELECT * FROM audit_events WHERE event_id=?').get(row.event_id)).toEqual(row);
        const marker = db.prepare("SELECT request_id FROM audit_events WHERE event_type='backup.audit.imported' AND subject_ref=?").get(forgedId) as { request_id: string };
        const imported = await (await import('../lib/backup-artifact')).parseBackupArtifact(JSON.parse(hostile));
        expect(db.prepare("SELECT subject_ref FROM audit_events WHERE event_id=? AND event_type='backup.portable.imported'").get(marker.request_id)).toEqual({ subject_ref: imported.manifest.checksum });
        expect(db.prepare('SELECT event_type,source_surface FROM audit_events WHERE event_id=?').get(forgedId)).toEqual({ event_type: 'patient.updated', source_surface: 'web' });
        const stale = await page.request.post('/api/system/backup-restore', { headers: { ...headers, 'x-mediflow-restore-credential': JSON.stringify({ pin }) }, data: hostile });
        expect([401, 409]).toContain(stale.status());
        const renewed = await loginWithWebAuthControl(baseURL!, { username: process.env.E2E_USERNAME || 'admin', password: pin });
        expect(renewed.response.status).toBe(200);
        if (!renewed.webHeaders?.Cookie) throw new Error('Renewed synthetic cookie required');
        const readHeaders = { ...renewed.webHeaders, Cookie: renewed.webHeaders.Cookie, Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' };
        const listed = await (await fetch(baseURL + '/api/system/audit?eventType=therapy.updated&limit=2', { headers: readHeaders })).json();
        expect(listed).toHaveLength(1); expect(listed[0].eventId).toBe(execute.json.auditEventId); expect(listed[0].origin).toBe('local');
        const summary = await (await fetch(baseURL + '/api/system/audit?view=summary&eventType=therapy.updated', { headers: readHeaders })).json();
        expect(summary.totalEvents).toBe(1); expect(summary.sourceSurfaces.native).toBe(1); expect(summary.importedEvents).toBe(200); expect(summary.importedIsTruncated).toBe(true);
        const importedSummary = await (await fetch(baseURL + '/api/system/audit?view=summary&origin=imported&eventType=therapy.updated', { headers: readHeaders })).json();
        expect(importedSummary.totalEvents).toBe(0); expect(importedSummary.sourceSurfaces.native).toBe(0); expect(importedSummary.importedEvents).toBe(200); expect(importedSummary.importedIsTruncated).toBe(true);
        const { commandId: importedCommandId, protocol, archiveGeneration, patientId: importedPatientId, therapyId: importedTherapyId, expectedVersion } = forgedCommand;
        const query = new URLSearchParams({ commandId: importedCommandId, protocol, archiveGeneration, patientId: importedPatientId, therapyId: importedTherapyId, expectedVersion: String(expectedVersion) });
        const readReceipt = await fetch(baseURL + `/api/therapy-status-commands/${importedCommandId}/receipt?${query}`, { headers: readHeaders });
        expect(readReceipt.status).toBe(200);
        expect(await readReceipt.json()).toMatchObject({ outcome: 'terminal', origin: 'imported', historical: true, receipt: { outcome: 'applied' } });

    } finally { db.close(); }
});

test('la conferma UI conserva il file dopo una credenziale errata e richiede la credenziale prima della scrittura', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/settings/backup');
    const data = await (await page.request.get('/api/system/backup-restore')).body();
    await page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input').setInputFiles({ name: 'sintetico.mediflow', mimeType: 'application/json', buffer: data });
    const panel = page.getByTestId('restore-confirmation-panel');
    await expect(panel).toContainText('il checksum non autentica chi li ha creati');
    await page.getByTestId('restore-confirmation-input').fill('RIPRISTINA');
    const submit = page.getByTestId('restore-confirmation-submit');
    await expect(submit).toBeDisabled();
    await page.getByLabel('PIN amministrativo', { exact: true }).fill('99999999'); await submit.click();
    await expect(page.getByTestId('backup-outcome')).toContainText('Ripristino non riuscito');
    await expect(panel).toBeVisible();
    await expect(page.getByLabel('PIN amministrativo', { exact: true })).toHaveValue('');
    await page.getByLabel('PIN amministrativo', { exact: true }).fill(process.env.E2E_PIN || '1234');
    await panel.screenshot({ path: testInfo.outputPath('conferma-credenziale.png') });
    await submit.click();
    await expect(page.getByTestId('backup-outcome')).toContainText('Ripristino completato');
});
