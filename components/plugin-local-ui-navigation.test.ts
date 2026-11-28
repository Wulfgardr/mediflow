import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as workExports from '../lib/plugin-local-ui-work.ts';
import { isLocalUiIntent } from '../packages/mcp/src/local-ui-intents.mjs';

type Element = { type: any; props: Record<string, any> };
function fixture(pluginRuntime = true) {
  let now = 0, index = 0, first = true, events: any, privacy = false;
  const values: any[] = [], effects: Array<() => void> = [];
  const timers: Array<{ at: number; cancelled: boolean; run(): void }> = [];
  const reads: Array<{ signal: AbortSignal; release(): void }> = [];
  const session = new AbortController();
  const subscriptions: string[] = [];
  const assigned: string[] = [];
  const work = workExports.createLocalUiWork();
  const workContext = {};
  const hooks = {
    createContext: (value: boolean) => ({ Provider: 'PluginLocalUiRuntimeProvider', defaultValue: value }),
    useContext: (context: unknown) => context === workContext ? work : pluginRuntime,
    useState(initial: unknown) {
      const key = index++;
      if (!(key in values)) values[key] = initial;
      return [values[key], (value: any) => { values[key] = typeof value === 'function' ? value(values[key]) : value; }];
    },
    useRef(initial: unknown) { const key = index++; if (!(key in values)) values[key] = { current: initial }; return values[key]; },
    useEffect(callback: () => void) { if (first) effects.push(callback); },
    useLayoutEffect(callback: () => void) { if (first) effects.unshift(callback); },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const common = (name: string): any => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    throw new Error(`unexpected_test_import:${name}`);
  };
  const privacyModule: any = { exports: {}, require(name: string) {
    if (name === '@/components/privacy-provider') return { usePrivacy: () => ({ isPrivacyMode: privacy }) };
    if (name === '@/lib/utils') return { cn: (...items: unknown[]) => items.filter(Boolean).join(' ') };
    return common(name);
  } };
  vm.runInNewContext(compile('./privacy-blur.tsx'), privacyModule, { timeout: 2_000 });
  const environment: any = { exports: {}, require(name: string) {
    if (name === '@/lib/plugin-local-ui-work') return workExports;
    if (name === './use-plugin-local-ui-work') return { PluginLocalUiWorkContext: workContext };
    if (name === './disclosure') return { Disclosure: ({ children }: { children: unknown }) => jsx('div', { children }) };
    if (name === './security-provider') return { useSecurity: () => ({ user: { id: 'synthetic-user' }, isLocked: false, isAuthenticated: true }) };
    if (name === './privacy-blur' || name === '@/components/privacy-blur') return privacyModule.exports;
    if (name === '@/lib/db') return { db: { getSessionReadSignal: () => session.signal } };
    if (name === '@/packages/mcp/src/local-ui-intents.mjs') return { isLocalUiIntent };
    return common(name);
  }, Date: { now: () => now }, AbortController, AbortSignal,
  setTimeout(run: () => void, delay: number) { const timer = { at: now + delay, cancelled: false, run }; timers.push(timer); return timer; },
  clearTimeout(timer: typeof timers[number] | undefined) { if (timer) timer.cancelled = true; },
  EventSource: function (url: string) { subscriptions.push(url); events = { close() {} }; return events; },
  document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
  window: { location: { hash: '', assign(url: string) { assigned.push(url); } }, addEventListener() {}, removeEventListener() {} }, HTMLDetailsElement: class {},
  fetch(_url: string, options: { signal: AbortSignal }) { return new Promise(resolve => {
    reads.push({ signal: options.signal, release: () => resolve({ ok: true, json: async () => ({ contractVersion: 1, selectionEpoch: 1 }) }) });
  }); } };
  vm.runInNewContext(compile('./plugin-local-ui-navigation.tsx'), environment, { timeout: 2_000 });
  const render = (): Element | null => {
    index = 0;
    const tree = environment.exports.PluginLocalUiNavigation({ patientId: 'synthetic-patient', patientVersion: 1, patientLabel: 'Nome Sintetico R1' });
    if (first) { first = false; for (const effect of effects) effect(); }
    return tree;
  };
  const elements = (node: any): Element[] => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    if (typeof node.type === 'function') return elements(node.type(node.props));
    return [node, ...elements(node.props?.children)];
  };
  render();
  return { render, elements, reads, session, subscriptions, assigned, setPrivacy(value: boolean) { privacy = value; },
    emit(intent = 'history') { events.onmessage({ data: intent }); },
    advance(time: number) { now = time; for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.run(); } },
    async release(index: number) { reads[index].release(); await new Promise(resolve => setImmediate(resolve)); },
    hash: () => environment.window.location.hash,
    confirm() { const button = elements(render()).find(node => node.type === 'button'); assert.ok(button); button.props.onClick(); },
  };
}

test('an initial epoch received beyond the event deadline is discarded; a new request in the same document works', async () => {
  const f = fixture();
  assert.deepEqual(f.subscriptions, ['/api/plugin-local-ui/events']);
  f.emit(); f.advance(16_000); await f.release(0);
  assert.equal(f.render(), null);
  assert.equal(f.reads[0].signal.aborted, true);
  assert.equal(f.hash(), '');
  f.emit(); await f.release(1);
  assert.ok(f.render()); f.confirm(); await f.release(2);
  assert.equal(f.hash(), 'timeline');
});

test('a timely epoch does not extend the fifteen seconds measured from the event', async () => {
  const f = fixture(); f.emit(); f.advance(10_000); await f.release(0);
  assert.ok(f.render()); f.advance(15_000);
  assert.equal(f.render(), null); assert.equal(f.hash(), '');
});

test('session retirement while the initial epoch is pending cannot publish or navigate', async () => {
  const f = fixture(); f.emit(); f.session.abort(); await f.release(0);
  assert.equal(f.render(), null); assert.equal(f.hash(), '');
});

test('the confirmation patient name uses the existing PrivacyBlur policy ON and OFF', async () => {
  const f = fixture(); f.emit('identity'); await f.release(0);
  f.setPrivacy(true);
  const protectedName = f.elements(f.render()).find(node => node.type === 'span' && node.props.children === 'Nome Sintetico R1');
  assert.ok(protectedName);
  assert.match(protectedName.props.className, /\bliquid-blur\b/u);
  assert.match(protectedName.props.className, /blur-\[5px\]/u);
  f.setPrivacy(false);
  const visibleName = f.elements(f.render()).find(node => node.type === 'span' && node.props.children === 'Nome Sintetico R1');
  assert.ok(visibleName); assert.equal(visibleName.props.className, undefined);
  assert.ok(JSON.stringify(f.render()).includes('conferma sulla cartella aperta di'));
});

test('ordinary runtime never subscribes to plugin navigation events', () => {
  const f = fixture(false);
  assert.equal(f.render(), null);
  assert.deepEqual(f.subscriptions, []);
  assert.deepEqual(f.reads, []);
});

test('new patient from documents opens the new record entry without reading or naming the open patient', async () => {
  const f = fixture(); f.emit('new_patient_from_documents');
  const shown = JSON.stringify(f.render());
  assert.deepEqual(f.reads, []);
  assert.ok(shown.includes('Nuova scheda dai documenti'));
  assert.ok(!shown.includes('Nome Sintetico R1'));
  f.confirm(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.assigned, ['/patients/new#documento']);
  assert.equal(f.hash(), '');
  assert.equal(f.render(), null);
});
