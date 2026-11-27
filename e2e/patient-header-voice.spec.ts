import { randomBytes } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';

import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openUnlockedDocument } from './utils';
import { syntheticPatient } from './local-voice-utils';
import { expectHeaderCommands, expectHeaderCommandsLaidOut } from './patient-header-commands';

test.describe.configure({ mode: 'serial', retries: 0 });
const pin = '314159';
const LAYOUTS = [
    { name: '390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
    { name: 'zoom-200', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
    { name: '1440', viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 },
];

async function openHeader(page: Page) {
    await bootstrapUnlockedSession(page, pin);
    const patientId = await syntheticPatient(page, 'Testata');
    await openUnlockedDocument(page, `/patients/${patientId}/modules`, pin);
    const header = page.getByTestId('lume-scheda-header');
    await expect(header).toBeVisible();
    await page.mouse.move(0, 0);
    return header;
}

async function capture(info: TestInfo, page: Page, name: string) {
    const path = info.outputPath(name);
    await page.getByTestId('lume-scheda-header').screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
}

const previous = { url: process.env.MEDIFLOW_LOCAL_VOICE_URL, secret: process.env.MEDIFLOW_LOCAL_VOICE_SECRET };
test.afterAll(() => {
    for (const [key, value] of [['MEDIFLOW_LOCAL_VOICE_URL', previous.url], ['MEDIFLOW_LOCAL_VOICE_SECRET', previous.secret]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

test.describe('servizio della voce configurato', () => {
    test.beforeAll(() => {
        process.env.MEDIFLOW_LOCAL_VOICE_URL = `http://127.0.0.1:${40_000 + Math.floor(Math.random() * 9_000)}`;
        process.env.MEDIFLOW_LOCAL_VOICE_SECRET = randomBytes(32).toString('hex');
    });
    for (const layout of LAYOUTS) {
        test.describe(layout.name, () => {
            test.use({ viewport: layout.viewport, deviceScaleFactor: layout.deviceScaleFactor });
            test(`la testata della scheda ha quattro comandi, leggibili e separati (${layout.name})`, async ({ page }, info) => {
                const header = await openHeader(page);
                await expectHeaderCommands(header, true);
                await expect(header.locator('.mf-button-primary:visible')).toHaveText(['Nuova voce']);
                await expectHeaderCommandsLaidOut(header);
                await capture(info, page, `testata-quattro-comandi-${layout.name}.png`);
            });
        });
    }
});

test.describe('servizio della voce assente', () => {
    test.beforeAll(() => {
        delete process.env.MEDIFLOW_LOCAL_VOICE_URL;
        delete process.env.MEDIFLOW_LOCAL_VOICE_SECRET;
    });
    for (const layout of LAYOUTS) {
        test.describe(layout.name, () => {
            test.use({ viewport: layout.viewport, deviceScaleFactor: layout.deviceScaleFactor });
            test(`la testata della scheda ha tre comandi, senza «Registra la visita» (${layout.name})`, async ({ page }, info) => {
                const header = await openHeader(page);
                await expectHeaderCommands(header, false);
                await expectHeaderCommandsLaidOut(header);
                await capture(info, page, `testata-tre-comandi-${layout.name}.png`);
            });
        });
    }
});
