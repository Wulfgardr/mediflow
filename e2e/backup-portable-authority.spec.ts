import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { serializeBackupArtifact } from '../lib/backup-artifact';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import { reviewedRestoreHeaders, documentRequests } from './fixtures/trusted-web-request';

test('comando terapia nativo, backup e importazione portabile conservano storico senza importare autorità', async ({ page, baseURL, playwright }) => {
    test.setTimeout(120_000);
    const dir = process.env.MEDIFLOW_DATA_DIR;
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !dir || !isAbsolute(dir) || !baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
        test.skip(true, 'Richiede un server sintetico isolato.'); return;
    }
    const pin = process.env.E2E_PIN || '1234';
    const localToken = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    if (!localToken) {
        test.skip(true, 'Richiede il token API del runner sintetico.'); return;
    }
    await fetch(baseURL + '/api/auth/native/therapy-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await bootstrapUnlockedSession(page, pin);
    const db = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    const originalNetworkMode = (db.prepare('SELECT value FROM settings WHERE key=?').get('network.mode') as { value: string } | undefined)?.value ?? 'local-only';
    const patientId = randomUUID(), therapyId = randomUUID(), forgedId = randomUUID();
    const actor = db.prepare('SELECT id FROM users WHERE username=?').get(process.env.E2E_USERNAME || 'admin') as { id: string };
    const scope = db.prepare('SELECT id FROM ambulatories LIMIT 1').get() as { id: string };
    const nativeClient = await playwright.request.newContext({
        baseURL,
        storageState: { cookies: [{ name: 'ambulatory_id', value: scope.id, domain: '127.0.0.1', path: '/',
            expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
    });
    async function call(path: string, data: unknown, headers: Record<string, string> = {}) {
        const response = await nativeClient.post(path, { data, headers });
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
    }
    const web = documentRequests(page);
    try {
        db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code) VALUES (?,?,?,?)').run(patientId, 'Persona', 'Sintetica U2', patientId);
        db.prepare('INSERT INTO patients_to_ambulatories(patient_id,ambulatory_id) VALUES (?,?)').run(patientId, scope.id);
        db.prepare("INSERT INTO therapies(id,patient_id,drug_name,dosage,status,start_date,version) VALUES (?,?,?,?,'active',unixepoch(),1)").run(therapyId, patientId, 'Farmaco sintetico', 'Dose sintetica');
        const mode = await web.put('/api/settings/network.mode', { data: { value: 'network-home-base' } }); expect(mode.ok()).toBe(true);
        const intent = await call('/api/v1/network/pairing-intents', { deviceName: 'U2 sintetico', clientPlatform: 'macos', appVersion: '0.9.1', requestedCapabilities: ['network.replica.readonly-patients', 'network.replica.readonly-therapies', 'network.replica.write-therapies'] });
        const paired = await call(`/api/v1/network/pairing-intents/${intent.intentId}/confirm`, {}, { Authorization: `Bearer ${localToken}` });
        const peer = { 'x-mediflow-paired-client-id': paired.pairedClient.clientId, 'x-mediflow-paired-client-token': paired.pairedClientToken };
        const login = await call('/api/auth/native/login', { username: process.env.E2E_USERNAME || 'admin', password: pin }, peer);
        const native = { ...peer, 'x-mediflow-archive-generation': login.archiveGeneration };
        const epoch = await (await nativeClient.get('/api/v1/network/patient-profile/selection-epoch', { headers: native })).json();
        const selection = await call(`/api/v1/network/patients/${patientId}/profile-query`, { kind: 'open', contractVersion: 1, projection: 'profile', expectedSelectionEpoch: epoch.selectionEpoch }, native);
        const selectionEpoch = selection.currentness.selectionEpoch;
        const open = await call('/api/auth/native/therapy-status', { operation: 'open', patientId, selectionEpoch }, native);
        const command = { commandId: randomUUID(), protocol: 'therapy.status.change.v1', archiveGeneration: login.archiveGeneration, patientId, therapyId, expectedVersion: 1, target: 'suspended' };
        await call('/api/auth/native/therapy-status', { operation: 'preview', command, viewId: open.viewId, selectionEpoch }, native);
        const execute = await call('/api/auth/native/therapy-status', { operation: 'execute', commandId: command.commandId, pin }, native);
        expect(execute.outcome).toBe('applied');
        const ledger = db.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId);
        const audit = db.prepare('SELECT * FROM audit_events WHERE request_id=?').get(command.commandId) as { source_surface: string };
        expect(audit.source_surface).toBe('native');
        const exported = await web.get('/api/system/backup-restore'); expect(exported.status()).toBe(200);
        const artifact = await exported.json();
        const verified = await web.post('/api/system/backup-restore/verify', { data: artifact }); expect(verified.status()).toBe(200);
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
        const firstRestoreIntent = await reviewedRestoreHeaders(page, hostile);
        for (const credential of [undefined, { pin: '99999999' }]) {
            const denied = await web.post('/api/system/backup-restore', { headers: { ...firstRestoreIntent, ...(credential ? { 'x-mediflow-restore-credential': JSON.stringify(credential) } : {}) }, data: hostile });
            expect(denied.status(), await denied.text()).toBe(401);
            expect(db.prepare('SELECT first_name FROM patients WHERE id=?').get(patientId)).toEqual({ first_name: 'Persona' });
            expect(db.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId)).toEqual(ledger);
            expect(db.prepare('SELECT * FROM audit_events WHERE event_id=?').get(forgedId)).toBeUndefined();
        }
        const localHistory = db.prepare('SELECT * FROM audit_events').all() as { event_id: string }[];
        const renewedIntent = await reviewedRestoreHeaders(page, hostile);
        const restored = await web.post('/api/system/backup-restore', { headers: { ...renewedIntent, 'x-mediflow-restore-credential': JSON.stringify({ pin }) }, data: hostile });
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
        expect((await web.get('/api/system/backup-restore')).status()).toBe(401);
        await bootstrapUnlockedSession(page, pin);
        const listed = await (await web.get('/api/system/audit?eventType=therapy.updated&limit=2')).json();
        expect(listed).toHaveLength(1); expect(listed[0].eventId).toBe(execute.auditEventId); expect(listed[0].origin).toBe('local');
        const summary = await (await web.get('/api/system/audit?view=summary&eventType=therapy.updated')).json();
        expect(summary.totalEvents).toBe(1); expect(summary.sourceSurfaces.native).toBe(1); expect(summary.importedEvents).toBe(200); expect(summary.importedIsTruncated).toBe(true);
        const importedSummary = await (await web.get('/api/system/audit?view=summary&origin=imported&eventType=therapy.updated')).json();
        expect(importedSummary.totalEvents).toBe(0); expect(importedSummary.sourceSurfaces.native).toBe(0); expect(importedSummary.importedEvents).toBe(200); expect(importedSummary.importedIsTruncated).toBe(true);
        const { commandId: importedCommandId, protocol, archiveGeneration, patientId: importedPatientId, therapyId: importedTherapyId, expectedVersion } = forgedCommand;
        const query = new URLSearchParams({ commandId: importedCommandId, protocol, archiveGeneration, patientId: importedPatientId, therapyId: importedTherapyId, expectedVersion: String(expectedVersion) });
        const readReceipt = await web.get(`/api/therapy-status-commands/${importedCommandId}/receipt?${query}`);
        expect(readReceipt.status()).toBe(200);
        expect(await readReceipt.json()).toMatchObject({ outcome: 'terminal', origin: 'imported', historical: true, receipt: { outcome: 'applied' } });

    } finally {
        try {
            await bootstrapUnlockedSession(page, pin);
            const reset = await web.put('/api/settings/network.mode', { data: { value: originalNetworkMode } });
            expect(reset.status(), await reset.text()).toBe(200);
        } finally {
            await nativeClient.dispose();
            db.close();
        }
    }
});

test('la conferma UI conserva il file dopo una credenziale errata e richiede la credenziale prima della scrittura', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/settings/backup');
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    const data = await (await documentRequests(page).get('/api/system/backup-restore')).body();
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
    await submit.click();
    await expect(page.getByTestId('backup-outcome')).toContainText('Verifica di nuovo il file');
    await expect(panel).toHaveCount(0);
    await page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input').setInputFiles({ name: 'sintetico.mediflow', mimeType: 'application/json', buffer: data });
    await page.getByTestId('restore-confirmation-input').fill('RIPRISTINA');
    await page.getByLabel('PIN amministrativo', { exact: true }).fill(process.env.E2E_PIN || '1234');
    await panel.screenshot({ path: testInfo.outputPath('conferma-credenziale.png') });
    await submit.click();
    await expect(page.getByTestId('backup-outcome')).toContainText('Ripristino completato');
});
