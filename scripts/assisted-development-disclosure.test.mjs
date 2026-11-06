import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `Manca la sezione ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};

test('il README dichiara chi decide e chi scrive il codice e rimanda alla pagina canonica', () => {
  const s = section(read('README.md'), '## Sviluppo assistito');
  for (const term of ['Codex e Claude Code', 'Intento', 'merge', 'agenti', 'CREDITS.md', './docs/development-usage.md']) {
    assert.ok(s.includes(term), `README, Sviluppo assistito: manca «${term}»`);
  }
});

test('la pagina canonica spiega «assistito» passaggio per passaggio', () => {
  const page = read('docs/development-usage.md');
  const roles = section(page, '## Che cosa significa «assistito»');
  for (const step of ['**Intento**', '**Pianificazione e architettura**', '**Scrittura del codice e dei test**',
    '**Prove richieste', '**Accettazione e merge**', '**Release e comunicazione**']) {
    assert.ok(roles.includes(step), `Manca il passaggio ${step}`);
  }
  assert.match(roles, /condizioni scritte/, 'Il merge delegato deve dichiarare le sue condizioni');
  for (const heading of ['## Principi dell\'autore', '## Attribuzione', '## Consumi dello sviluppo']) section(page, heading);
  assert.ok(page.indexOf('## Consumi dello sviluppo') < page.indexOf('<!-- usage-dashboard:start -->'),
    'Lo storico dei token deve restare nella stessa pagina della disclosure');
});

test('il modello di PR chiede prove, limiti, fonti esterne e attribuzione dell\'agente', () => {
  const t = read('.github/pull_request_template.md');
  for (const heading of ['## Problema', '## Modifica', '## Prove', '## Non verificato', '## Fonti esterne']) {
    assert.ok(t.includes(heading), `Modello di PR: manca ${heading}`);
  }
  assert.match(t, /modello e strumento/);
});

test('CONTRIBUTING applica le stesse regole ai contributi scritti con agenti', () => {
  const s = read('CONTRIBUTING.md');
  const agents = s.slice(s.indexOf('### Contributi scritti con agenti'));
  assert.ok(s.includes('### Contributi scritti con agenti'));
  for (const term of ['Co-Authored-By', 'CREDITS.md', 'non lo stile di scrittura', 'prove']) {
    assert.ok(agents.includes(term), `CONTRIBUTING: manca «${term}»`);
  }
});
