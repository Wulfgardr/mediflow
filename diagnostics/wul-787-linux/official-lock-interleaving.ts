import fs from 'node:fs';
import path from 'node:path';
import { installOfficialLockObservation } from './official-lock-observation';
import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test';

type NativeExpect = (expression: string, options: { isNot?: boolean; [key: string]: unknown }) => Promise<unknown>;
type InternalLocator = Locator & { _expect: NativeExpect };
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

export async function armOfficialLockInterleaving(page: Page, evidencePath: string) {
  const received = latch();
  const delivery = latch();
  const getByLabel = page.getByLabel.bind(page);
  const getByRole = page.getByRole.bind(page);
  const previousLabel = page.getByLabel;
  const previousRole = page.getByRole;
  const pin = getByLabel('PIN operatore', { exact: true });
  const renew = getByRole('button', { name: 'Rinnova accesso', exact: true });
  const form = getByLabel('MediFlow lock screen', { exact: true }).locator('form');
  const observation = installOfficialLockObservation(page);
  const events: Array<Record<string, unknown>> = [];
  let lockRequests = 0;
  let loginRequests = 0;
  let releaseSource: 'pin-ready-assertion' | 'renew-isVisible-true' | 'cleanup' | undefined;
  let expectCalls = 0;
  let visibleCalls = 0;
  let enabledCalls = 0;
  let confirmedReceipt = false;
  let held = false;
  let routeError: string | undefined;
  const record = (event: string, details: Record<string, unknown> = {}) => {
    const entry = observation.record(event, details);
    if (entry) events.push(entry);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify({
      schemaVersion: 'mediflow.fixture.official-lock-interleaving.v1',
      lockRequests, loginRequests, releaseSource, expectCalls, visibleCalls, enabledCalls,
      confirmedReceipt, held, routeError, events, observation: observation.snapshot(),
    }, null, 2));
  };
  try {
  record('armed');
  const requestListener = (request: Request) => {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/lock') lockRequests += 1;
    if (pathname === '/api/auth/login') loginRequests += 1;
    if (pathname === '/api/auth/lock' || pathname === '/api/auth/login') record('request', { pathname });
  };
  page.on('request', requestListener);
  const handler = async (route: Route) => {
    try {
      if (route.request().method() !== 'POST') throw new Error('FIXTURE_NON_POST_LOCK');
      const response = await route.fetch();
      expect(response.status(), 'fixture needs the real confirmed operation, not an auth fault').toBe(200);
      expect(await response.json()).toEqual({
        schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed',
      });
      expect(Boolean(response.headers().etag)).toBe(true);
      confirmedReceipt = true;
      held = true;
      record('real-receipt-held', { status: response.status(), etagPresent: true });
      received.release();
      await delivery.promise;
      await route.fulfill({ response });
      held = false;
      record('real-receipt-delivered');
    } catch (error) {
      routeError = error instanceof Error ? error.message : String(error);
      record('fixture-route-error');
      received.release();
      throw error;
    }
  };
  await page.route('**/api/auth/lock', handler);

  const releaseAuthenticReceipt = async (source: Exclude<typeof releaseSource, undefined | 'cleanup'>) => {
    await received.promise;
    if (routeError) throw new Error(`FIXTURE_ROUTE_FAILED: ${routeError}`);
    expect(held).toBe(true);
    expect(confirmedReceipt).toBe(true);
    expect(lockRequests).toBe(1);
    expect(loginRequests).toBe(0);
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await expect(pin).toBeDisabled();
    await expect(renew).toBeVisible();
    await expect(renew).toBeDisabled();
    releaseSource = source;
    record('delivery-release', { source, pinDisabled: true, formBusy: true, noLogin: true });
    delivery.release();
  };

  const wrappedLabel: Page['getByLabel'] = (text, options) => {
    const locator = getByLabel(text, options);
    if (text !== 'PIN operatore') return locator;
    const internal = locator as InternalLocator;
    if (typeof internal._expect !== 'function') throw new Error('FIXTURE_PW1582_EXPECT_SEAM_MISSING');
    const nativeExpect = internal._expect.bind(locator);
    internal._expect = async (expression, expectOptions) => {
      if (expression === 'to.be.enabled' && !expectOptions.isNot && !releaseSource) {
        expectCalls += 1;
        record('native-pin-expect-entered');
        await releaseAuthenticReceipt('pin-ready-assertion');
      }
      return nativeExpect(expression, expectOptions);
    };
    return locator;
  };
  const wrappedRole: Page['getByRole'] = (role, options) => {
    const locator = getByRole(role, options);
    if (role !== 'button' || options?.name !== 'Rinnova accesso' || options.exact !== true) return locator;
    const nativeVisible = locator.isVisible.bind(locator);
    const nativeEnabled = locator.isEnabled.bind(locator);
    locator.isVisible = async visibleOptions => {
      const visible = await nativeVisible(visibleOptions);
      visibleCalls += 1;
      record('native-renew-isVisible-result', { visible });
      if (visible && !releaseSource) {
        await releaseAuthenticReceipt('renew-isVisible-true');
        await expect(pin).toBeEnabled();
        await expect(pin).toHaveValue('');
        await expect(renew).toHaveCount(0);
        record('ready-between-native-queries', { pinEnabled: true, pinEmpty: true, renewCount: 0, loginRequests });
      }
      return visible;
    };
    locator.isEnabled = async enabledOptions => {
      enabledCalls += 1;
      record('native-renew-isEnabled-entered');
      if (releaseSource === 'renew-isVisible-true') {
        await expect(pin).toBeEnabled();
        await expect(renew).toHaveCount(0);
        expect(loginRequests).toBe(0);
        await page.screenshot({ path: evidencePath.replace(/\.json$/, '-before-isEnabled.png') });
        record('observable-block-precondition', { pinEnabled: true, renewCount: 0, loginRequests, lockRequests });
      }
      return nativeEnabled(enabledOptions);
    };
    return locator;
  };
  page.getByLabel = wrappedLabel;
  page.getByRole = wrappedRole;

  return {
    async assertGreen() {
      expect(routeError).toBeUndefined();
      expect(releaseSource).toBe('pin-ready-assertion');
      expect(confirmedReceipt).toBe(true);
      expect(expectCalls).toBe(1);
      expect(visibleCalls).toBe(1);
      expect(enabledCalls).toBe(0);
      expect(events.filter(event => event.event === 'native-renew-isVisible-result').map(({ event, visible }) => ({ event, visible }))).toEqual([
        { event: 'native-renew-isVisible-result', visible: false },
      ]);
      expect(lockRequests).toBe(1);
      expect(loginRequests).toBe(1);
      record('green-observable-completion');
    },
    async dispose() {
      const failures: unknown[] = [];
      try { record('fixture-dispose-entered'); } catch (error) { failures.push(error); }
      try {
        if (!releaseSource) releaseSource = 'cleanup';
        delivery.release();
        if (page.getByLabel === wrappedLabel) page.getByLabel = previousLabel;
        if (page.getByRole === wrappedRole) page.getByRole = previousRole;
        page.off('request', requestListener);
        if (!page.isClosed()) await page.unroute('**/api/auth/lock', handler);
      } catch (error) { failures.push(error); }
      finally {
        observation.restore();
        try { record('fixture-disposed'); } catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new Error('OFFICIAL_FIXTURE_DISPOSE_FAILURES\n' + failures.map((error, index) =>
        `[${index}] ${error instanceof Error ? error.stack : String(error)}`).join('\n'), { cause: failures[0] });

    },
  };
  } catch (error) {
    observation.restore();
    try { record('fixture-arm-failed'); } catch { /* Preserve the original setup failure. */ }
    throw error;
  }
}
