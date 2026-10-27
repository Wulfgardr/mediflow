import { expect, test, type Page, type Locator, type Response } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { bootstrapUnlockedSession, assertNotClippedInViewport } from './utils';
import { installFunctionsEgressGuard } from './fixtures/settings-functions';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const baseline = process.env.SCALES_READ_BASELINE === '1';
const visualSupplement = process.env.SCALES_READ_VISUAL_SUPPLEMENT === '1';
const phase = `${baseline ? 'baseline' : 'candidate'}${visualSupplement ? '-visual-supplement' : ''}`;
const titleSuffix = visualSupplement ? ' [visual-only supplement]' : '';
const patientId = '10000000-0000-4000-8000-000000000001';
const patient = { id: patientId, firstName: 'Sintetica Alessandra Maria Francesca',
    lastName: 'Dimostrativa Cognome composto molto lungo per verifica visiva', taxCode: 'SNTTST80A01H501X',
    birthDate: '1980-01-01T00:00:00.000Z', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' };
type ReadMode = 'ready' | 'pending' | 'error' | 'empty' | 'missing';
function artifactDirectory() {
    const shared = process.env.SCALES_READ_SCREENSHOTS;
    return shared ? join(shared, phase, `${test.info().testId.replace(/[^a-zA-Z0-9_-]/gu, '_')}-retry-${test.info().retry}`)
        : test.info().outputPath('screenshots');
}
function requireSynthetic(baseURL?: string): asserts baseURL is string {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic loopback required');
}

async function capture(page: Page, target: Locator, name: string, frames: unknown[], zoomFactor?: 1 | 2) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const wheel = zoomFactor ? await target.evaluate(element => {
        for (let owner = element.parentElement; owner; owner = owner.parentElement) {
            if (owner.scrollHeight <= owner.clientHeight || !/auto|scroll/u.test(getComputedStyle(owner).overflowY)) continue;
            const rect = owner.getBoundingClientRect(), box = element.getBoundingClientRect();
            const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom), before = owner.scrollTop;
            const expected = Math.max(0, Math.min(owner.scrollHeight - owner.clientHeight, before + box.top + box.height / 2 - (top + bottom) / 2));
            return { x: rect.left + rect.width / 2, y: (top + bottom) / 2, before, expected, delta: expected - before };
        }
        return null;
    }) : null;
    if (wheel && zoomFactor) {
        await page.mouse.move(wheel.x, wheel.y); await page.mouse.wheel(0, wheel.delta * zoomFactor);
        await expect.poll(() => target.evaluate((element, expected) => {
            for (let owner = element.parentElement; owner; owner = owner.parentElement)
                if (owner.scrollHeight > owner.clientHeight && /auto|scroll/u.test(getComputedStyle(owner).overflowY)) return Math.abs(owner.scrollTop - expected);
            return Number.POSITIVE_INFINITY;
        }, wheel.expected)).toBeLessThanOrEqual(1);
    }
    await assertNotClippedInViewport(target, name);
    const evidence = await target.evaluate(element => {
        const rect = element.getBoundingClientRect(), inset = Math.min(8, rect.width / 4, rect.height / 4);
        const points = [[rect.x + rect.width / 2, rect.y + rect.height / 2], [rect.x + inset, rect.y + inset],
            [rect.right - inset, rect.y + inset], [rect.x + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]]
            .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === element || !!hit && element.contains(hit) }; });
        const scrollOwners = [];
        for (let p = element.parentElement; p; p = p.parentElement)
            if (p.scrollHeight > p.clientHeight && /auto|scroll/u.test(getComputedStyle(p).overflowY)) scrollOwners.push({ tag: p.tagName, scrollTop: p.scrollTop });
        return { bounds: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, viewport: { width: innerWidth, height: innerHeight },
            color: getComputedStyle(element).color, points, scrollOwners, text: element.textContent?.trim() };
    });
    const directory = artifactDirectory(); await mkdir(directory, { recursive: true });
    const path = join(directory, `${name}.png`); await page.screenshot({ path, fullPage: false });
    frames.push({ name, path, ...evidence, ...(wheel && zoomFactor ? { wheel: { ...wheel, zoomFactor, sentDelta: wheel.delta * zoomFactor } } : {}) });
    await writeFile(join(directory, 'frames.json'), JSON.stringify(frames, null, 2));
    expect(evidence.bounds.top, name).toBeGreaterThanOrEqual(-1);
    expect(evidence.bounds.bottom, name).toBeLessThanOrEqual(evidence.viewport.height + 1);
    expect(evidence.points.every(point => point.hit), `${name}: center and inset corners`).toBe(true);
    return evidence;
}

async function captureLongNameAt400(page: Page, target: Locator, name: string, frames: unknown[]) {
    const expected = `${patient.lastName} ${patient.firstName}`, covered = new Set<number>(), captures: unknown[] = [];
    const directory = artifactDirectory(); await mkdir(directory, { recursive: true });
    const inspect = () => target.evaluate(element => {
        const text = element.textContent ?? '', nodes: Text[] = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
        const location = (offset: number) => {
            for (const node of nodes) { if (offset < node.length) return { node, offset }; offset -= node.length; }
            throw Error('Name character offset unavailable');
        };
        const characters = Array.from({ length: text.length }, (_, index) => {
            const rangeAt = (startIndex: number, endIndex: number) => {
                const start = location(startIndex), end = location(endIndex - 1), range = document.createRange();
                range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset + 1); return range;
            };
            const sourceRange = rangeAt(index, index + 1), sourceRect = sourceRange.getBoundingClientRect();
            const contextualWhitespace = /\s/u.test(text[index]) && (sourceRect.height === 0 || sourceRect.width === 0);
            const rangeStart = contextualWhitespace ? Math.max(0, index - 1) : index;
            const rangeEnd = contextualWhitespace ? Math.min(text.length, index + 2) : index + 1;
            const range = rangeAt(rangeStart, rangeEnd), fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
            const points = fragments.flatMap(rect => {
                const inset = Math.min(1, rect.width / 4, rect.height / 4);
                return [[rect.x + rect.width / 2, rect.y + rect.height / 2], [rect.x + inset, rect.y + inset],
                    [rect.right - inset, rect.y + inset], [rect.x + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]]
                    .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === element || !!hit && element.contains(hit) }; });
            });
            const top = Math.min(...fragments.map(rect => rect.top)), bottom = Math.max(...fragments.map(rect => rect.bottom));
            const left = Math.min(...fragments.map(rect => rect.left)), right = Math.max(...fragments.map(rect => rect.right));
            return { index, character: text[index], contextualWhitespace, rangeStart, rangeEnd, rangeText: range.toString(),
                sourceBounds: { top: sourceRect.top, bottom: sourceRect.bottom, left: sourceRect.left, right: sourceRect.right, width: sourceRect.width, height: sourceRect.height },
                bounds: { top, bottom, left, right, height: bottom - top, width: right - left },
                fragments: fragments.map(rect => ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })), points,
                visible: fragments.length > 0 && top >= 0 && bottom <= innerHeight && left >= 0 && right <= innerWidth && points.every(point => point.hit) };
        });
        const box = element.getBoundingClientRect(), x = box.x + box.width / 2;
        let top = 0, bottom = innerHeight;
        for (const overlay of document.querySelectorAll<HTMLElement>('body *')) {
            if (overlay.contains(element) || !['sticky', 'fixed'].includes(getComputedStyle(overlay).position)) continue;
            const rect = overlay.getBoundingClientRect();
            if (rect.left > x || rect.right < x || rect.bottom <= 0 || rect.top >= innerHeight) continue;
            if (rect.top <= innerHeight / 2) top = Math.max(top, rect.bottom); else bottom = Math.min(bottom, rect.top);
        }
        for (let owner = element.parentElement; owner; owner = owner.parentElement) {
            if (owner.scrollHeight <= owner.clientHeight || !/auto|scroll/u.test(getComputedStyle(owner).overflowY)) continue;
            const rect = owner.getBoundingClientRect();
            return { text, characters, color: getComputedStyle(element).color, viewport: { width: innerWidth, height: innerHeight }, aperture: { top, bottom },
                owner: { tag: owner.tagName, scrollTop: owner.scrollTop, maximum: owner.scrollHeight - owner.clientHeight,
                    x: rect.left + rect.width / 2, y: (Math.max(top, rect.top) + Math.min(bottom, rect.bottom)) / 2 } };
        }
        throw Error('Name scroll owner unavailable');
    });
    let evidence = await inspect(); expect(evidence.text).toBe(expected);
    for (let index = 0; index < 4 && covered.size < expected.length; index++) {
        const first = evidence.characters.find(character => !covered.has(character.index))!;
        const before = evidence.owner.scrollTop, expectedOffset = Math.max(0, Math.min(evidence.owner.maximum,
            before + first.bounds.top - evidence.aperture.top - 4));
        await page.mouse.move(evidence.owner.x, evidence.owner.y);
        await page.mouse.wheel(0, (expectedOffset - before) * 4);
        await expect.poll(async () => Math.abs((await inspect()).owner.scrollTop - expectedOffset)).toBeLessThanOrEqual(1);
        evidence = await inspect();
        const readable = evidence.characters.filter(character => character.visible);
        readable.forEach(character => covered.add(character.index));
        const path = join(directory, `${name}-segment-${index + 1}.png`); await page.screenshot({ path, fullPage: false });
        const capture = { name: `${name}-segment-${index + 1}`, path, kind: 'name-character-coverage', ...evidence,
            readableIndices: readable.map(character => character.index), wheel: { zoomFactor: 4, cssDelta: expectedOffset - before,
                sentDelta: (expectedOffset - before) * 4, before, expectedOffset, observedOffset: evidence.owner.scrollTop } };
        captures.push(capture); frames.push(capture);
        await writeFile(join(directory, 'frames.json'), JSON.stringify(frames, null, 2));
        await writeFile(join(directory, `${name}-coverage.json`), JSON.stringify({ expected, totalCharacters: expected.length,
            coveredIndices: [...covered].sort((a, b) => a - b), uncoveredIndices: evidence.characters.filter(character => !covered.has(character.index)).map(character => character.index),
            simultaneousFullNameClaim: false, captures }, null, 2));
        expect(readable.length, 'Each real scroll must expose name characters').toBeGreaterThan(0);
    }
    expect(covered.size, 'Every character, including spaces, readable in at least one measured frame').toBe(expected.length);
    return evidence;
}

async function layoutFrames(zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>, target: Locator, stem: string, frames: unknown[]) {
    const dayColors = new Map<number | string, string>();
    for (const theme of ['giorno', 'grafite']) for (const size of [320, 'zoom-400'] as const) {
        await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(size === 320 ? 1 : 4);
        if (size === 320) await zoom.page.setViewportSize({ width: 320, height: 1000 });
        await zoom.page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.dataset.theme = theme; }, theme);
        const evidence = !baseline && stem === 'search-long-identity' && size === 'zoom-400'
            ? await captureLongNameAt400(zoom.page, target, `${stem}-${theme}-${size}`, frames)
            : await capture(zoom.page, target, `${stem}-${theme}-${size}`, frames);
        if (theme === 'giorno') dayColors.set(size, evidence.color); else expect(evidence.color).not.toBe(dayColors.get(size));
    }
    await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    await zoom.page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme = 'giorno'; });
}

type VisualState = 'search-error' | 'search-long-identity' | 'patient-library-missing' | 'runner-error';
type VisualReuse = { phase: 'baseline' | 'candidate'; state: VisualState; source: string; buildID: string; theme: 'giorno'; format: 1440;
    path: string; sha256: string; color: string; points: { hit: boolean }[] };
async function supplementFrames(zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>, target: Locator,
    state: VisualState, frames: unknown[], reusedFrames: VisualReuse[]) {
    if (!visualSupplement) throw Error('Visual-only supplement required');
    const manifestPath = process.env.SCALES_READ_REUSE_MANIFEST, expectedHash = process.env.SCALES_READ_REUSE_MANIFEST_SHA256;
    if (!manifestPath || !expectedHash || !process.env.SCALES_READ_EXPECTED_SOURCE) throw Error('Pinned prior frames and source required');
    const bytes = await readFile(manifestPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
    const manifest: { frames: VisualReuse[] } = JSON.parse(bytes.toString());
    const reuse = manifest.frames.find(frame => frame.phase === (baseline ? 'baseline' : 'candidate') && frame.state === state);
    if (!reuse) throw Error(`Missing prior Giorno1440 frame: ${state}`);
    expect(reuse.source).toBe(process.env.SCALES_READ_EXPECTED_SOURCE);
    expect(reuse.buildID).toBe(process.env.SCALES_READ_EXPECTED_BUILD_ID);
    expect(reuse.theme).toBe('giorno'); expect(reuse.format).toBe(1440);
    expect(reuse.points).toHaveLength(5); expect(reuse.points.every(point => point.hit)).toBe(true);
    expect(createHash('sha256').update(await readFile(reuse.path)).digest('hex')).toBe(reuse.sha256);
    reusedFrames.push(reuse);
    const dayColors = new Map<number | string, string>([[1440, reuse.color]]);
    for (const theme of ['giorno', 'grafite']) for (const size of [1440, 768, 390, 'zoom-200'] as const) {
        if (theme === 'giorno' && size === 1440) continue;
        await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(size === 'zoom-200' ? 2 : 1);
        if (typeof size === 'number') await zoom.page.setViewportSize({ width: size, height: 1000 });
        await zoom.page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.dataset.theme = theme; }, theme);
        const evidence = await capture(zoom.page, target, `${state}-${theme}-${size}`, frames, size === 'zoom-200' ? 2 : 1);
        if (theme === 'giorno') dayColors.set(size, evidence.color); else expect(evidence.color).not.toBe(dayColors.get(size));
    }
    await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    await zoom.page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme = 'giorno'; });
}

async function installScaleReads(page: Page, baseURL?: string) {
    requireSynthetic(baseURL);
    const guard = await installFunctionsEgressGuard(page, baseURL);
    const state: { list: ReadMode; patient: ReadMode } = { list: 'ready', patient: 'ready' };
    const calls: { sequence: number; path: string; mode: ReadMode }[] = [];
    const observations: unknown[] = [], errors: string[] = [], frames: unknown[] = [], reusedFrames: VisualReuse[] = [];
    const completed: { sequence: number; path: string; status: number; finished: true }[] = [];
    const gates = new Set<() => void>();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/patients{,/**,?*}', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== new URL(baseURL).origin || request.method() !== 'GET') return route.fallback();
        if (path !== '/api/patients' && path !== `/api/patients/${patientId}`) return route.fallback();
        const list = path === '/api/patients', mode = list ? state.list : state.patient;
        const sequence = calls.length + 1, headers = { 'x-scales-fixture-read': String(sequence) };
        calls.push({ sequence, path, mode });
        if (mode === 'pending') await new Promise<void>(resolve => { gates.add(resolve); });
        if (mode === 'error') return route.fulfill({ status: 503, headers, json: { error: 'Synthetic patient read failed' } });
        if (!list && mode === 'missing') return route.fulfill({ status: 404, headers, json: { error: 'Synthetic patient absent' } });
        return route.fulfill({ headers, json: list ? mode === 'empty' ? [] : [patient] : patient });
    });
    async function finished(response: Response) {
        expect(await response.finished()).toBeNull();
        completed.push({ sequence: Number(response.headers()['x-scales-fixture-read']), path: new URL(response.url()).pathname, status: response.status(), finished: true });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    const release = () => { gates.forEach(resolve => resolve()); gates.clear(); };
    return { state, calls, observations, frames, reusedFrames, release,
        async observeRead(path: string, mode: ReadMode, action: () => Promise<unknown>) {
            const after = calls.length;
            if (mode === 'pending') {
                await action();
                await expect.poll(() => calls.some(call => call.sequence > after && call.path === path && call.mode === mode)).toBe(true);
                return;
            }
            const response = page.waitForResponse(response => new URL(response.url()).pathname === path
                && response.request().method() === 'GET' && Number(response.headers()['x-scales-fixture-read']) > after);
            const [received] = await Promise.all([response, action()]);
            expect(received.status()).toBe(mode === 'error' ? 503 : mode === 'missing' ? 404 : 200);
            await finished(received);
        },
        async releaseAndFinish(path: string) {
            const sequence = calls.filter(call => call.path === path && call.mode === 'pending').at(-1)?.sequence;
            if (!sequence) throw Error('Held read required');
            const response = page.waitForResponse(response => Number(response.headers()['x-scales-fixture-read']) === sequence);
            release(); await finished(await response);
        },
        async finish() {
            gates.forEach(resolve => resolve()); gates.clear();
            const directory = artifactDirectory();
            await mkdir(directory, { recursive: true });
            await writeFile(`${directory}/read-receipt.json`, JSON.stringify({ phase, baseline, visualSupplement, formats: visualSupplement ? [1440, 768, 390, 'zoom-200'] : [320, 'zoom-400'], reusedFrames, directory, testId: test.info().testId,
                retry: test.info().retry, calls, completed, observations, frames,
                blocked: guard.blocked, uiWrites: guard.mockedUiWrites, errors }, null, 2));
            expect(guard.blocked).toEqual([]); expect(errors).toEqual([]);
        } };
}

test('Scales library: search pending, error, empty, long identity and stale-term exclusion' + titleSuffix, async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        if (visualSupplement) {
            for (const mode of ['error', 'ready'] as const) {
                mock.state.list = mode;
                await mock.observeRead('/api/patients', mode, async () => {
                    await page.goto('/scales');
                    await page.locator('#catalogo').getByRole('button', { name: /ADL \(Indice di Katz\)/u }).click();
                });
                const section = page.locator('#paziente');
                const state: VisualState = mode === 'error' ? 'search-error' : 'search-long-identity';
                const target = mode === 'ready' ? section.getByRole('button', { name: /^Avvia /u }).locator('strong')
                    : baseline ? section.getByRole('heading', { name: 'Scegli il paziente', exact: true }) : section.getByRole('alert');
                mock.observations.push({ visualOnly: true, state, baselineDefect: baseline && mode === 'error' ? 'Read error not surfaced' : baseline ? 'Identity truncation' : null });
                await supplementFrames(zoom, target, state, mock.frames, mock.reusedFrames);
            }
            return;
        }
        for (const mode of ['pending', 'error', 'empty', 'ready'] as const) {
            mock.state.list = mode;
            await mock.observeRead('/api/patients', mode, async () => {
                await page.goto('/scales');
                await page.getByRole('button', { name: /ADL \(Indice di Katz\)/u }).click();
            });
            const section = page.locator('#paziente'), start = section.getByRole('button', { name: /^Avvia /u });
            if (mode === 'pending' || mode === 'error') {
                await expect(start).toHaveCount(0);
                if (baseline) {
                    await expect(section.getByRole('alert')).toHaveCount(0);
                    mock.observations.push({ mode, statusTexts: await section.getByRole('status').allTextContents(),
                        busy: await section.getAttribute('aria-busy') });
                } else {
                    await expect(section.getByRole(mode === 'pending' ? 'status' : 'alert')).toHaveCount(1);
                    if (mode === 'pending') {
                        await expect(section.locator(':scope > div[aria-busy]')).toHaveAttribute('aria-busy', 'true');
                        await expect(section.getByRole('status')).not.toContainText('Nessuna scheda');
                    }
                }
                const target = baseline ? section.getByRole('heading', { name: 'Scegli il paziente', exact: true })
                    : section.getByRole(mode === 'pending' ? 'status' : 'alert');
                await capture(page, target, `search-${mode}-1440`, mock.frames);
                if (mode === 'error') {
                    await layoutFrames(zoom, target, 'search-error', mock.frames);
                    if (!baseline) {
                        const search = section.getByRole('textbox', { name: 'Cerca paziente per nome o codice fiscale', exact: true });
                        await mock.observeRead('/api/patients', 'error', () => search.fill('Dimostrativa'));
                        mock.state.list = 'ready';
                        await mock.observeRead('/api/patients', 'ready', () => section.getByRole('button', { name: 'Riprova', exact: true }).click());
                        await expect(start).toHaveCount(1);
                        await expect(search).toHaveValue('Dimostrativa');
                        await expect(page.locator('#catalogo').getByRole('button', { name: /ADL \(Indice di Katz\)/u })).toHaveAttribute('aria-pressed', 'true');
                        mock.observations.push({ retry: 'search503ToReady', termPreserved: true, scalePreserved: true });
                    }
                }
            } else if (mode === 'empty') {
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
                await expect(start).toHaveCount(0);
                await capture(page, section.getByRole('status'), 'search-empty-1440', mock.frames);
            } else {
                await expect(start).toHaveCount(1);
                await expect(start).toHaveAccessibleName(`Avvia ADL (Indice di Katz) per ${patient.lastName} ${patient.firstName}`);
                const name = start.locator('strong');
                await capture(page, name, 'search-identity-1440', mock.frames);
                await layoutFrames(zoom, name, 'search-long-identity', mock.frames);
                await page.setViewportSize({ width: 320, height: 1000 });
                const identity = await name.evaluate(element => ({ text: element.textContent, scroll: element.scrollWidth,
                    width: element.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow }));
                mock.observations.push({ identity });
                if (baseline) { expect(identity.overflow).toBe('ellipsis'); expect(identity.scroll).toBeGreaterThan(identity.width); }
                else { expect(identity.whiteSpace).not.toBe('nowrap'); expect(identity.scroll).toBeLessThanOrEqual(identity.width + 1); }
                if (!baseline) {
                    const search = section.getByRole('textbox', { name: 'Cerca paziente per nome o codice fiscale', exact: true });
                    await search.scrollIntoViewIfNeeded();
                    const inputLayout = await search.evaluate(input => {
                        const rect = input.getBoundingClientRect(), icon = input.parentElement!.querySelector('svg')!.getBoundingClientRect();
                        return { textStart: rect.left + parseFloat(getComputedStyle(input).paddingLeft), iconRight: icon.right };
                    });
                    mock.observations.push({ inputLayout });
                    expect(inputLayout.textStart).toBeGreaterThan(inputLayout.iconRight);
                }
                mock.state.list = 'pending';
                await mock.observeRead('/api/patients', 'pending', () => section.getByRole('textbox',
                    { name: 'Cerca paziente per nome o codice fiscale', exact: true }).fill('NessunaCorrispondenza'));
                await expect(start).toHaveCount(baseline ? 1 : 0);
                mock.observations.push({ oldResultSelectableDuringNewTerm: await start.count() });
                await capture(page, baseline ? name : section.getByRole('status'), 'search-new-term-pending-320', mock.frames);
                await mock.releaseAndFinish('/api/patients');
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
                await capture(page, section.getByRole('status'), 'search-new-term-complete-320', mock.frames);
            }
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});

test('Patient scales library: pending, failed, absent and ready patient before offering start' + titleSuffix, async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        if (visualSupplement) {
            mock.state.patient = 'missing';
            await mock.observeRead(`/api/patients/${patientId}`, 'missing', () => page.goto(`/patients/${patientId}/scales`));
            const target = baseline ? page.getByRole('heading', { name: 'Scale cliniche', exact: true }) : page.locator('#libreria').getByRole('status');
            mock.observations.push({ visualOnly: true, state: 'patient-library-missing', baselineDefect: baseline ? 'Absent patient still offers start' : null });
            await supplementFrames(zoom, target, 'patient-library-missing', mock.frames, mock.reusedFrames);
            return;
        }
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await mock.observeRead(`/api/patients/${patientId}`, mode, () => page.goto(`/patients/${patientId}/scales`));
            const library = page.locator('#libreria'), links = library.getByRole('link');
            await expect(links).toHaveCount(baseline || mode === 'ready' ? 5 : 0);
            if (!baseline && mode !== 'ready') await expect(library.getByRole(mode === 'error' ? 'alert' : 'status')).toHaveCount(1);
            mock.observations.push({ mode, startLinks: await links.count() });
            const target = baseline && mode !== 'ready' ? page.getByRole('heading', { name: 'Scale cliniche', exact: true })
                : mode === 'ready' ? links.first() : library.getByRole(mode === 'error' ? 'alert' : 'status');
            await capture(page, target, `patient-library-${mode}-1440`, mock.frames);
            if (mode === 'missing') await layoutFrames(zoom, target, 'patient-library-missing', mock.frames);
            if (!baseline && mode === 'error') {
                mock.state.patient = 'ready';
                await mock.observeRead(`/api/patients/${patientId}`, 'ready', () => library.getByRole('button', { name: 'Riprova', exact: true }).click());
                await expect(links).toHaveCount(5);
                await expect(library.getByRole('alert')).toHaveCount(0);
                mock.observations.push({ retry: 'patientLibrary503ToReady', startLinks: await links.count() });
            }
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});

test('Scale runner: patient pending, failure and absence never become a valid form' + titleSuffix, async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        if (visualSupplement) {
            mock.state.patient = 'error';
            await mock.observeRead(`/api/patients/${patientId}`, 'error', () => page.goto(`/patients/${patientId}/scales/adl`));
            const target = page.locator('#scala').getByRole(baseline ? 'status' : 'alert');
            mock.observations.push({ visualOnly: true, state: 'runner-error', baselineDefect: baseline ? 'Read error still shown as loading' : null });
            await supplementFrames(zoom, target, 'runner-error', mock.frames, mock.reusedFrames);
            return;
        }
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await mock.observeRead(`/api/patients/${patientId}`, mode, () => page.goto(`/patients/${patientId}/scales/adl`));
            const form = page.locator('#scala');
            if (mode === 'ready') {
                await expect(form.getByRole('radio')).not.toHaveCount(0);
                await expect(form.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
            } else {
                await expect(form.getByRole('radio')).toHaveCount(0);
                if (baseline || mode === 'pending') await expect(form.getByText('Caricamento paziente…', { exact: true })).toBeVisible();
                else if (mode === 'error') await expect(form.getByRole('alert')).toHaveCount(1);
                else await expect(form.getByRole('status')).not.toContainText(/Caricamento/iu);
                mock.observations.push({ mode, formAbsent: true, loadingText: await form.getByText('Caricamento paziente…', { exact: true }).isVisible() });
            }
            const target = mode === 'ready' ? form.locator('legend h3') : form.getByRole(!baseline && mode === 'error' ? 'alert' : 'status');
            await capture(page, target, `runner-${mode}-1440`, mock.frames);
            if (mode === 'error') {
                await layoutFrames(zoom, target, 'runner-error', mock.frames);
                if (!baseline) {
                    mock.state.patient = 'ready';
                    await mock.observeRead(`/api/patients/${patientId}`, 'ready', () => form.getByRole('button', { name: 'Riprova', exact: true }).click());
                    await expect(form.getByRole('radio').first()).toBeEnabled();
                    await expect(form.getByRole('alert')).toHaveCount(0);
                    mock.observations.push({ retry: 'runner503ToReady', formEnabled: true });
                }
            }
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});
