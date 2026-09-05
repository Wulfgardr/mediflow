import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MINI_HEADLESS_REFERENTIAL_STATUSES } from './headless-referential-status';

/* @Codex */
const COMMANDS = ['patient search', 'patient show', 'draft preview', 'open-loops', 'whoami', 'capabilities'] as const;
const KEYS = [
  'schema', 'miniCommandId', 'status', 'availability', 'manualDisposition',
  'grantability', 'operationId', 'applicationServiceRef', 'applyPolicy', 'writesPerformed',
] as const;

test('projects the six historical Mini commands as referential denials', () => {
  assert.equal(MINI_HEADLESS_REFERENTIAL_STATUSES.length, 6);
  for (let index = 0; index < COMMANDS.length; index += 1) {
    const item = MINI_HEADLESS_REFERENTIAL_STATUSES[index]!;
    assert.deepEqual(Reflect.ownKeys(item), KEYS);
    assert.deepEqual({ ...item }, {
      schema: 'mediflow.mini.headless-referential-status.v1',
      miniCommandId: COMMANDS[index],
      status: 'denied',
      availability: 'unavailable',
      manualDisposition: 'manual_only',
      grantability: 'not_grantable',
      operationId: null,
      applicationServiceRef: null,
      applyPolicy: 'none',
      writesPerformed: 0,
    });
  }
});

test('publishes only immutable null-prototype status records', () => {
  assert.equal(Object.isFrozen(MINI_HEADLESS_REFERENTIAL_STATUSES), true);
  assert.equal(Object.getPrototypeOf(MINI_HEADLESS_REFERENTIAL_STATUSES), null);
  for (let index = 0; index < MINI_HEADLESS_REFERENTIAL_STATUSES.length; index += 1) {
    const item = MINI_HEADLESS_REFERENTIAL_STATUSES[index]!;
    assert.equal(Object.isFrozen(item), true);
    assert.equal(Object.getPrototypeOf(item), null);
    for (const key of KEYS) assert.deepEqual(Object.getOwnPropertyDescriptor(item, key), {
      value: item[key], enumerable: true, configurable: false, writable: false,
    });
    for (const leaked of ['anchorId', 'evidence', 'unresolved', 'authority', 'provider', 'venue', 'egress', 'then']) {
      assert.equal(Reflect.has(item, leaked), false);
    }
    assert.throws(() => { (item as { status: string }).status = 'available'; }, TypeError);
    assert.throws(() => { delete (item as { status?: string }).status; }, TypeError);
    assert.throws(() => { Object.setPrototypeOf(item, {}); }, TypeError);
  }
});

test('does not inspect hostile values or ambient iterator and then hooks', () => {
  let reads = 0;
  const hostile = new Proxy(Object.create(null), { get() { reads += 1; throw new Error('must not read'); } });
  const accessor = Object.create(null) as object;
  Object.defineProperty(accessor, 'then', { get() { reads += 1; throw new Error('must not read'); } });
  for (const value of [hostile, accessor]) {
    assert.throws(() => { (MINI_HEADLESS_REFERENTIAL_STATUSES[0] as { status: unknown }).status = value; }, TypeError);
  }
  assert.equal(reads, 0);

  const loader = new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).href;
  assert.equal(new URL(loader).protocol, 'file:');
  const target = new URL('./headless-referential-status.ts', import.meta.url).href;
  const childSource = `const {MINI_HEADLESS_REFERENTIAL_STATUSES:s}=await import(${JSON.stringify(target)}); const getPrototypeOf=Object.getPrototypeOf,defineProperty=Object.defineProperty; let reads=0,unhandled=0; process.on('unhandledRejection',()=>unhandled++); defineProperty(Object.prototype,'then',{configurable:true,get(){reads++;throw Error('then')}}); defineProperty(Array.prototype,Symbol.iterator,{configurable:true,value(){throw Error('iterator')}}); if(s.length!==6||getPrototypeOf(s)!==null||getPrototypeOf(s[0])!==null||s[0].status!=='denied'||s[0].then!==undefined)process.exit(1); setImmediate(()=>process.exit(reads||unhandled?1:0));`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', childSource], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test('keeps the implementation import-only and free of transport or authority seams', () => {
  const source = readFileSync(fileURLToPath(new URL('./headless-referential-status.ts', import.meta.url)), 'utf8');
  const imports = source.match(/^import .*;$/gm) ?? [];
  assert.deepEqual(imports, ["import { APPLICATION_OPERATION_DESCRIPTORS } from '../../../lib/headless/application-operation-registry';"]);
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function|anchorId|evidence|unresolved|authority|provider|venue|egress/i);
  assert.doesNotMatch(source, /\b(?:argv|stdin|stdout|process|fetch|WebSocket|XMLHttpRequest|IPC|drizzle|sqlite)\b|semantic-runtime|SOAP|agent-interface/i);
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:store|security|fabric|route|db)[^'"]*['"]/i);
});
