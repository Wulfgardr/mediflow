import Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { encryptData, getKdfVersion, unwrapMasterKeyVersioned } from '../../lib/security/security';
import { deriveUnlockMaterial, openUnlockWrapping, UNLOCK_KDF_VERSION } from '../../lib/security/unlock-credential';
import { bootstrapUnlockedSession, onboardingPassphrase } from '../utils';
import { documentRequests } from './trusted-web-request';

const sheetOperator = { displayName: 'Dott. Sintetico', ambulatoryName: 'Ambulatorio di prova' };

type SyntheticWrapping = { encryptedMasterKey: string; salt: string };

async function syntheticArchiveSealer(archivePath: string, userId: string, pin: string) {
    const database = new Database(archivePath, { readonly: true, fileMustExist: true });
    let wrapping: SyntheticWrapping | undefined;
    try {
        wrapping = database.prepare<[string], SyntheticWrapping>('SELECT encrypted_master_key AS encryptedMasterKey, salt FROM users WHERE id = ?').get(userId);
    } finally {
        database.close();
    }
    if (!wrapping) throw new Error('Il profilo sbloccato deve appartenere all’archivio sintetico indicato.');
    const { encryptedMasterKey, salt } = wrapping;
    const saltBytes = Buffer.from(salt, 'base64');
    const passphrase = getKdfVersion(encryptedMasterKey) === UNLOCK_KDF_VERSION;
    const material = passphrase ? await deriveUnlockMaterial(onboardingPassphrase(pin, sheetOperator), saltBytes) : null;
    const key = material
        ? await openUnlockWrapping(encryptedMasterKey, material.kek)
        : await unwrapMasterKeyVersioned(encryptedMasterKey, pin, saltBytes);
    return async (value: unknown) => {
        const { iv, data } = await encryptData(value, key);
        return `ENC:${iv}:${data}`;
    };
}

export async function unlockSyntheticSheet(page: Page, baseURL: string | undefined) {
    const archive = process.env.MEDIFLOW_DATA_DIR;
    const url = baseURL ? new URL(baseURL) : null;
    if (!archive || url?.protocol !== 'http:' || !url.port || url.hostname !== '127.0.0.1' || url.port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1'
        || !statSync(join(archive, 'SYNTHETIC_ONLY'), { throwIfNoEntry: false })?.isFile()) {
        throw new Error('Serve l’archivio SYNTHETIC_ONLY del banco E2E su una porta dedicata.');
    }
    const archivePath = join(archive, 'medical.db');
    const pin = process.env.E2E_PIN || '1234';
    const [login] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login'
            && response.request().method() === 'POST'),
        bootstrapUnlockedSession(page, pin, sheetOperator),
    ]);
    expect(login.status()).toBe(200);
    const profile = await documentRequests(page).get('/api/auth/profile');
    expect(profile.status()).toBe(200);
    const identity = await profile.json() as { userId: string; displayName: string; ambulatoryName: string };
    expect(typeof identity.userId).toBe('string');
    if (process.env.MEDIFLOW_CONCEPT_SCREENSHOTS || process.env.MEDIFLOW_DIARY_READING_SCREENSHOTS) {
        expect(identity).toMatchObject(sheetOperator);
    }
    const seal = await syntheticArchiveSealer(archivePath, identity.userId, pin);
    const settings = page.getByRole('link', { name: 'Impostazioni', exact: true });
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/u);

    return {
        archivePath,
        seal,
        async post(entity: string, data: Record<string, unknown>) {
            const response = await documentRequests(page).post(`/api/${entity}`, { data });
            expect(response.status(), `Preparazione sintetica: ${entity}`).toBe(201);
            return (await response.json() as { id: string }).id;
        },
    };
}

export async function openSyntheticPatient(page: Page, query: string, name: string, id: string) {
    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill(query);
    const patient = page.getByRole('option').filter({ hasText: name });
    await expect(patient).toBeVisible();
    await patient.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/patients/${id}/modules$`));
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTimeOrigin);
}
