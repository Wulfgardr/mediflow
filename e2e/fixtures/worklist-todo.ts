import type { Page, Route } from '@playwright/test';

export async function installWorklistTodoFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const patient = (id: string, birthDate: string | null, isArchived = false) => ({ id, firstName: 'Persona', lastName: `Inventata ${id}`,
    taxCode: `W21SYNTH${id}`, birthDate, isArchived, isAdi: true, status: 'active',
    diagnoses: [{ system: 'TEST', code: id, description: `Categoria sintetica ${id}` }],
    createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' });
  const known = patient('A', '1970-04-12T00:00:00.000Z');
  const state = { patients: [known, patient('B', null), patient('C', null), patient('Z', null, true)], status: 200, hold: null as Promise<void> | null, checkups: [] as Array<{ id: string; patientId: string; title: string; date: string; status: string; deletedAt?: string }>, checkupStatus: 200, checkupHold: null as Promise<void> | null };
  const calls: { path: string; search: string; status: number; scope: string | null; patientIds?: string[] }[] = [];
  const blocked: string[] = [], uiWrites: unknown[] = [];
  const uiDefaults: Record<string, boolean> = { uiReduceMotion: false, uiReduceTransparency: false };
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const deny = () => { blocked.push(`${method} ${url.href}`); return route.abort(); };
    if (url.origin !== origin) return deny();
    const key = path.startsWith('/api/settings/') ? path.slice('/api/settings/'.length) : undefined;
    if (method === 'GET' && key && Object.hasOwn(uiDefaults, key)) return route.fulfill({ json: { key, value: false } });
    if (method === 'GET' && key) return route.fulfill({ json: { key, value: null } });
    if (method === 'GET' && path === '/api/settings') return route.fulfill({ json: {} });
    if (method === 'POST' && path === '/api/settings') {
      const body = request.postDataJSON();
      if (body && Object.keys(body).length === 2 && Object.hasOwn(uiDefaults, body.key) && body.value === false) {
        uiWrites.push(body); return route.fulfill({ json: body });
      }
      return deny();
    }
    if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
    if (path === '/api/siss/session-status' && method === 'GET') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
    if (path === '/api/clinical-agenda/candidates' && method === 'GET') return route.fulfill({ json: { enabled: false,
      stats: { candidates: 0, parsed: 0, ignored: 0, invalid: 0 }, candidates: [], sources: [] } });
    if (path === '/api/patients' && method === 'GET') {
      const status = state.status, rows = structuredClone(state.patients), hold = state.hold;
      const cookie = await request.headerValue('cookie');
      const scope = cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('ambulatory_id=')) ?? null;
      calls.push({ path, search: url.search, status, scope, patientIds: rows.map(row => row.id) });
      if (hold) await hold;
      return route.fulfill({ status, json: status === 200 ? rows : { error: 'SYNTHETIC_WORKLIST_UNAVAILABLE' } });
    }
    if (path === '/api/system/audit' && method === 'GET' && url.searchParams.get('view') === 'summary') {
      calls.push({ path, search: url.search, status: 200, scope: null });
      return route.fulfill({ json: { days: Number(url.searchParams.get('days')), totalEvents: 7, distinctActors: 2,
        outcomes: { success: 5, failure: 1, denied: 1 }, sourceSurfaces: { web: 7, native: 0, api: 0, job: 0 },
        topEventTypes: [{ eventType: 'synthetic_event', count: 7 }], isTruncated: false } });
    }
    if (path === '/api/checkups' && method === 'GET' && !url.searchParams.has('patientId')) {
      const status = state.checkupStatus, rows = structuredClone(state.checkups), hold = state.checkupHold;
      calls.push({ path, search: url.search, status, scope: null });
      if (hold) await hold;
      return route.fulfill({ status, json: status === 200 ? rows : { error: 'SYNTHETIC_CHECKUPS_UNAVAILABLE' } });
    }
    if (method === 'GET' && /^\/api\/patients\/[^/]+$/.test(path)) {
      const patient = state.patients.find(row => row.id === path.split('/').at(-1));
      return route.fulfill({ status: patient ? 200 : 404, json: patient ?? { error: 'SYNTHETIC_NOT_FOUND' } });
    }
    if (/^\/api\/(checkups|entries|therapies|observations|attachments|conversations|messages|service-prescription-items|service-prescriptions|prosthetic-prescriptions|siss-handoffs)(?:\/|$)/.test(path)) return method === 'GET' ? route.fulfill({ json: [] }) : deny();
    const ownedAuth = ['/api/auth/check', '/api/auth/setup', '/api/auth/login', '/api/auth/lock', '/api/auth/rewrap-master-key'].includes(path);
    const ownedRead = method === 'GET' && (path === '/api/onboarding/work-profile' || path === '/api/system/revision');
    if (path.startsWith('/api/') && !ownedAuth && !ownedRead) return deny();
    return route.continue();
  };
  await page.route('**/*', handler);
  return { state, calls, blocked, uiWrites, known, close: () => page.unroute('**/*', handler) };
}
