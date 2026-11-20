import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { stableStringify, type BackupArtifact } from '../lib/backup-artifact';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession, onboardingPassphrase, unlockIfNeeded } from './utils';

const backupPath = '/api/system/backup-restore';
const pin = '1234';

async function openBackup(page: Page) {
    await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
    await page.locator('a[href="/settings/backup"]:visible').first().click();
    await expect(page.getByText('Seleziona file .mediflow v1', { exact: true })).toBeVisible();
}

function withUpdatedManifest(artifact: BackupArtifact): Buffer {
    artifact.manifest.recordCounts = Object.fromEntries(Object.entries(artifact.payload)
        .map(([collection, rows]) => [collection, rows.length])) as BackupArtifact['manifest']['recordCounts'];
    artifact.manifest.checksum = createHash('sha256').update(stableStringify(artifact.payload)).digest('hex');
    return Buffer.from(JSON.stringify(artifact));
}

function backupFile(name: string, buffer: Buffer) {
    return { name, mimeType: 'application/json', buffer };
}

function archiveRows(db: Database.Database) {
    return db.transaction(() => Object.fromEntries(
        (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[])
            .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]),
    ))();
}

function integrity(db: Database.Database) {
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
}

test('il Web rifiuta una conferma superata e consente il ripristino e il recupero della copia precedente', async ({ page, isolatedRuntime }, testInfo) => {
    test.setTimeout(90_000);
    await bootstrapUnlockedSession(page, pin);
    await openBackup(page);
    const web = documentRequests(page);
    const created = await web.post('/api/patients', {
        data: { firstName: 'Paziente', lastName: 'Sintetico', taxCode: 'SYN-WUL908-WEB' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = await created.json();
    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
    try {
        const exported = await web.get(backupPath);
        expect(exported.ok()).toBe(true);
        const legacy = await exported.json() as BackupArtifact;
        delete legacy.payload.auditEvents;
        delete legacy.payload.ambulatoryDestructiveCommands;
        legacy.manifest.collections = legacy.manifest.collections.filter(name => name !== 'auditEvents' && name !== 'ambulatoryDestructiveCommands');
        const legacyFile = backupFile('copia-v1-precedente.mediflow', withUpdatedManifest(legacy));
        const input = page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input');
        const panel = page.getByTestId('restore-confirmation-panel');
        const keyword = page.getByTestId('restore-confirmation-input');
        const credential = page.getByLabel('Passphrase amministrativa', { exact: true });
        const submit = page.getByTestId('restore-confirmation-submit');
        const outcome = page.getByTestId('backup-outcome');
        const enterConfirmation = async () => {
            await keyword.fill('RIPRISTINA');
            await credential.fill(onboardingPassphrase(pin));
            await expect(submit).toBeEnabled();
        };
        const waitForRestore = () => page.waitForResponse(response =>
            new URL(response.url()).pathname === backupPath && response.request().method() === 'POST');

        await input.setInputFiles(legacyFile);
        await expect(panel).toBeVisible();
        await enterConfirmation();
        db.prepare('UPDATE patients SET version=version+1 WHERE id=?').run(id);

        const previous = await web.get(backupPath);
        expect(previous.ok()).toBe(true);
        const previousFile = backupFile('prima-del-ripristino.mediflow', await previous.body());
        const before = archiveRows(db);
        const conflict = waitForRestore();
        await submit.click();
        const blocked = await conflict;
        expect(blocked.status(), await blocked.text()).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: 'restore_blocked', reason: 'snapshot' });
        expect(archiveRows(db)).toEqual(before);
        integrity(db);
        await expect(panel).toHaveCount(0);
        await expect(outcome).toContainText('Verifica di nuovo il file');
        await outcome.screenshot({ path: testInfo.outputPath('conflitto.png') });

        const preview = page.waitForResponse(response => new URL(response.url()).pathname === backupPath + '/verify');
        await input.setInputFiles(legacyFile);
        await expect(panel).toBeVisible();
        const reviewed = await (await preview).json();
        await expect(keyword).toHaveValue('');
        await expect(credential).toHaveValue('');
        await expect(submit).toBeDisabled();
        await panel.screenshot({ path: testInfo.outputPath('nuova-conferma.png') });
        await enterConfirmation();
        const beforeRestore = await web.get('/api/auth/check');
        expect(await beforeRestore.json()).toMatchObject({ hasSession: true });
        const restored = waitForRestore();
        const reload = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        await submit.click();
        const completed = await restored;
        expect(completed.status(), await completed.text()).toBe(200);
        const sent = completed.request();
        expect(await sent.headerValue('x-mediflow-restore-snapshot')).toBe(reviewed.expectedSnapshot);
        expect(await sent.headerValue('x-mediflow-restore-source-checksum')).toBe(legacy.manifest.checksum);
        expect(await sent.headerValue('x-mediflow-restore-confirmation')).toBe('RIPRISTINA');
        const receipt = (await completed.json()).receipt;
        expect(receipt).toMatchObject({ id: await sent.headerValue('x-mediflow-restore-id'), sourceChecksum: legacy.manifest.checksum });
        expect(db.prepare('SELECT version FROM patients WHERE id=?').get(id)).toEqual({ version: 1 });
        await expect(outcome).toContainText('Ripristino completato');
        await expect.poll(async () => (await web.get('/api/auth/check')).json()).toMatchObject({ hasSession: false });
        await reload;
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await unlockIfNeeded(page, pin);
        await expect(input).toBeVisible();
        const readback = await web.get(`/api/patients/${id}`);
        expect(readback.status()).toBe(200);
        expect(await readback.json()).toMatchObject({ id, version: 1 });

        await input.setInputFiles(previousFile);
        await expect(panel).toBeVisible();
        await enterConfirmation();
        const recovered = waitForRestore();
        const reloaded = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        await submit.click();
        expect((await recovered).status()).toBe(200);
        expect((await web.get(`/api/patients/${id}`)).status()).toBe(401);
        await reloaded;
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await unlockIfNeeded(page, pin);
        const previousVersion = await web.get(`/api/patients/${id}`);
        expect(previousVersion.status()).toBe(200);
        expect(await previousVersion.json()).toMatchObject({ id, version: 2 });
        const after = archiveRows(db);
        expect(after.patients).toEqual(before.patients);
        expect(after.users).toEqual(before.users);
        for (const event of before.audit_events) expect(after.audit_events).toContainEqual(event);
        expect(after.audit_events.filter(row => (row as { event_type: string }).event_type === 'backup.portable.imported')).toHaveLength(2);
        integrity(db);
    } finally { db.close(); }
});

test('copie con riferimenti clinici incoerenti vengono rifiutate in verifica e ripristino', async ({ page, isolatedRuntime }) => {
    test.setTimeout(90_000);
    await bootstrapUnlockedSession(page, pin);
    await openBackup(page);
    const web = documentRequests(page);
    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
    try {
        db.transaction(() => {
            for (const id of ['synthetic-1', 'synthetic-2']) {
                db.prepare("INSERT INTO patients(id,first_name,last_name,tax_code) VALUES (?,'Nome','Sintetico',?)").run(id, id);
            }
            db.prepare("INSERT INTO service_prescriptions(id,patient_id,prescribed_at,service_name) VALUES ('rx','synthetic-1',100,'Prestazione')").run();
            db.prepare("INSERT INTO service_prescription_items(id,prescription_id,patient_id,service_name) VALUES ('item','rx','synthetic-1','Prestazione')").run();
            db.prepare("INSERT INTO observations(id,patient_id,code_system,code,display,unit_system,unit_code,value,observed_at,service_prescription_item_id) VALUES ('obs','synthetic-1','synthetic','obs','Osservazione','synthetic','u','1',100,'item')").run();
        })();
        const exported = await web.get(backupPath);
        expect(exported.status(), await exported.text()).toBe(200);
        const valid = await exported.json() as BackupArtifact;
        const verify = (data: Buffer) => web.post(backupPath + '/verify', {
            data,
        });
        const beforePreview = archiveRows(db);
        const preview = await verify(Buffer.from(JSON.stringify(valid)));
        expect(preview.status(), await preview.text()).toBe(200);
        expect(archiveRows(db)).toEqual(beforePreview);
        const { expectedSnapshot, sourceChecksum } = await preview.json();
        const before = archiveRows(db);
        const restoreHeaders = {
            'x-mediflow-restore-id': '12345678-1234-4123-8123-123456789012',
            'x-mediflow-restore-snapshot': expectedSnapshot,
            'x-mediflow-restore-source-checksum': sourceChecksum,
            'x-mediflow-restore-confirmation': 'RIPRISTINA',
        };
        const other = structuredClone(valid);
        other.payload.observations[0].value = '2';
        const different = await web.post(backupPath, { data: withUpdatedManifest(other), headers: restoreHeaders });
        expect(different.status(), await different.text()).toBe(409);
        expect(await different.json()).toMatchObject({ reason: 'source' });
        expect(archiveRows(db)).toEqual(before);
        for (const [collection, key, value] of [
            ['observations', 'patientId', 'synthetic-2'],
            ['servicePrescriptionItems', 'patientId', 'synthetic-2'],
            ['observations', 'servicePrescriptionItemId', 'absent'],
            ['servicePrescriptionItems', 'prescriptionId', 'absent'],
        ] as const) {
            const inconsistent = structuredClone(valid);
            inconsistent.payload[collection][0][key] = value;
            const data = withUpdatedManifest(inconsistent);
            const failed = await verify(data);
            expect(failed.status(), await failed.text()).toBe(412);
            expect((await failed.json()).preflight.checks).toContainEqual(expect.objectContaining({ id: 'artifact-references', status: 'fail' }));
            expect(archiveRows(db)).toEqual(before);
            const restore = await web.post(backupPath, { data, headers: restoreHeaders });
            expect(restore.status(), await restore.text()).toBe(412);
            expect(archiveRows(db)).toEqual(before);
        }
        const inconsistent = structuredClone(valid);
        inconsistent.payload.observations[0].patientId = 'synthetic-2';
        await page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input')
            .setInputFiles(backupFile('riferimento-incoerente.mediflow', withUpdatedManifest(inconsistent)));
        await expect(page.getByTestId('backup-outcome')).toContainText('Backup non valido');
        await expect(page.getByTestId('restore-confirmation-panel')).toHaveCount(0);
        expect(archiveRows(db)).toEqual(before);
        integrity(db);
    } finally { db.close(); }
});
