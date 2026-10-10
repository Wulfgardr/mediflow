import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { portableLocalTestCommands } from './portable-local-test-selection.mjs';
import { runPortableLocalCommands } from './run-portable-local-tests.mjs';
const root = path.resolve(import.meta.dirname, '..');
test('profile consumes existing recipes and selectors without duplicate wrappers/children', () => {
  const commands = portableLocalTestCommands(root);
  assert.equal(commands.length, 46);
  assert.equal(commands.some(command => command.id === 'local:test:installability-v0'), false);
  const files = commands.flatMap(command => command.files);
  assert.equal(new Set(files).size, files.length);
  const soft = commands.find(command => command.id === 'local:test:patient-soft-delete');
  assert.ok(soft.files.includes('scripts/patient-soft-delete.test.mjs'));
  assert.ok(soft.files.includes('scripts/patient-cascade.test.mjs'));
  assert.ok(!commands.some(command => command.id === 'soft-delete:local' || command.id === 'local:test:patient-cascade'));
  assert.ok(commands.every(command => !command.args.includes('--browser') && !command.args.includes('--browser-only')));
});
test('runner preserves argv, isolates/bootstrap fixtures, reports failures and cleans after all children', () => {
  const directories = [];
  const calls = [];
  const commands = [{ id: 'first', executable: 'synthetic', args: ['kept'], env: { FIXTURE: 'yes' }, bootstrap: true },
    { id: 'second', executable: 'synthetic', args: ['next'], env: {} }];
  const outcomes = runPortableLocalCommands(root, commands, { env: { PATH: '' }, spawn(executable, args, options) {
    assert.equal(options.shell, false);
    assert.equal(fs.existsSync(options.env.MEDIFLOW_DATA_DIR), true);
    directories.push(options.env.MEDIFLOW_DATA_DIR); calls.push([executable, args]);
    return { status: calls.length === 2 ? 7 : 0 };
  } });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0][1], ['scripts/prepare-e2e-db.mjs']);
  assert.deepEqual(calls[1][1], ['kept']);
  assert.deepEqual(outcomes.map(value => value.status), [7, 0]);
  assert.equal(directories[0], directories[1]); assert.notEqual(directories[1], directories[2]);
  assert.ok(directories.every(directory => !fs.existsSync(directory)));
});
test('failed bootstrap skips its target and preserves signal/error outcomes with cleanup', () => {
  const directories = [];
  let calls = 0;
  const outcomes = runPortableLocalCommands(root, [
    { id: 'bootstrap-failure', executable: 'not-run', args: [], env: {}, bootstrap: true },
    { id: 'signal', executable: 'synthetic', args: [], env: {} },
  ], { env: {}, spawn(_executable, _args, options) {
    calls++; directories.push(options.env.MEDIFLOW_DATA_DIR);
    return calls === 1 ? { status: 19, error: new Error('synthetic bootstrap failure') } : { status: null, signal: 'SIGTERM' };
  } });
  assert.equal(calls, 2);
  assert.equal(outcomes[0].status, 19); assert.equal(outcomes[0].error, 'synthetic bootstrap failure');
  assert.equal(outcomes[1].signal, 'SIGTERM');
  assert.ok(directories.every(directory => !fs.existsSync(directory)));
});
