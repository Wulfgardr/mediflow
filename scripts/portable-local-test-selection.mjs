import fs from 'node:fs';
import path from 'node:path';
import { localTestCommands, localInvocationArguments } from './local-test-selection.mjs';
import { collectAdditionalInventorySelections } from './additional-inventory-selection.mjs';

export function portableLocalTestCommands(root) {
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'scripts/portable-local-test-profile.json'), 'utf8'));
  if (profile.version !== 1 || !Array.isArray(profile.suiteIds) || !profile.suiteIds.length
    || new Set(profile.suiteIds).size !== profile.suiteIds.length
    || JSON.stringify(profile.coveredSuites) !== JSON.stringify({ 'local:test:patient-soft-delete': ['soft-delete:local', 'local:test:patient-cascade'] }))
    throw new Error('Invalid portable local profile');
  const local = new Map(localTestCommands(root).map(command => ['local:' + command.id, command]));
  const additional = collectAdditionalInventorySelections(root);
  const seen = new Set();
  return profile.suiteIds.map(id => {
    const recipe = local.get(id);
    let command;
    if (recipe) command = { id, executable: recipe.executable, args: localInvocationArguments(recipe, []), env: recipe.env, files: [...recipe.files] };
    else {
      const selected = additional[id];
      if (!selected || selected.errors.length || selected.mode !== 'local') throw new Error(`Invalid portable suite: ${id}`);
      const match = /^node ([\w./-]+)$/.exec(selected.binding.command);
      if (!match) throw new Error(`Unsupported portable consumer: ${id}`);
      command = { id, executable: process.execPath, args: [match[1]], env: {}, files: [...selected.files] };
    }
    for (const covered of profile.coveredSuites[id] ?? []) {
      if (profile.suiteIds.includes(covered)) throw new Error('Duplicate wrapper/child selection');
      const selection = additional[covered];
      const files = selection ? (!selection.errors.length && selection.files) : local.get(covered)?.files;
      if (!files) throw new Error(`Invalid covered suite: ${covered}`);
      command.files.push(...files);
    }
    command.files = [...new Set(command.files)];
    for (const file of command.files) {
      if (seen.has(file)) throw new Error(`Duplicate portable test: ${file}`);
      seen.add(file);
    }
    command.bootstrap = id === 'local:app/api/ai/local-provider/onboarding/route.test.ts';
    return command;
  });
}
