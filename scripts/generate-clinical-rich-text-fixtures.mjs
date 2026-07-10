#!/usr/bin/env node

/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Register the same TypeScript loader used by scripts/run-strip-types.mjs before
// loading the production sanitizer. The fixture oracle is the web implementation,
// not a copy of its rules.
import './register-strip-types-loader.mjs';

const { sanitizeClinicalRichTextHtml } = await import('../lib/clinical-rich-text.ts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, '../native/contracts/clinical-rich-text-fixtures.v1.json');

const soapTemplate = [
  '<p>S: motivo della visita, sintomi riferiti, contesto funzionale</p>',
  '<p>O: parametri, esame obiettivo, elementi documentali</p>',
  '<p>A: valutazione clinica da rivedere</p>',
  '<p>P: piano, follow-up, indicazioni condivise</p>',
].join('');

const cases = [
  { name: 'empty-input', input: '' },
  { name: 'plain-text', input: 'Nota clinica senza markup' },
  { name: 'paragraph', input: '<p>Visita di controllo</p>' },
  { name: 'line-break', input: '<p>Prima riga<br />Seconda riga</p>' },
  { name: 'strong', input: '<p><strong>Allergia nota</strong></p>' },
  { name: 'emphasis', input: '<p><em>Da confermare</em></p>' },
  { name: 'underline', input: '<p><u>Dato rilevante</u></p>' },
  { name: 'strikethrough', input: '<p><s>Terapia sospesa</s></p>' },
  { name: 'unordered-list', input: '<ul><li>Emocromo</li><li>PCR</li></ul>' },
  { name: 'ordered-list', input: '<ol><li>Valutare</li><li>Ricontrollare</li></ol>' },
  { name: 'heading-h1', input: '<h1>Diario clinico</h1>' },
  { name: 'heading-h2', input: '<h2>Valutazione</h2>' },
  { name: 'heading-h3', input: '<h3>Piano</h3>' },
  { name: 'blockquote', input: '<blockquote>Riferito dal caregiver</blockquote>' },
  { name: 'alias-div', input: '<div>Paragrafo legacy</div>' },
  { name: 'alias-bold', input: '<p><b>Importante</b></p>' },
  { name: 'alias-italic', input: '<p><i>Osservazione</i></p>' },
  { name: 'alias-strike', input: '<p><strike>Non attuale</strike></p>' },
  { name: 'alias-del', input: '<p><del>Rimosso</del></p>' },
  { name: 'remove-script-with-content', input: '<p>Prima</p><script>alert(1)</script><p>Dopo</p>' },
  { name: 'remove-style-with-content', input: '<style>body{display:none}</style><p>Visibile</p>' },
  { name: 'remove-iframe-with-content', input: '<iframe src="https://evil.test">segreto</iframe><p>Sicuro</p>' },
  { name: 'remove-object-with-content', input: '<object data="x">payload</object><p>Sicuro</p>' },
  { name: 'remove-embed-with-content', input: '<embed src="x">payload</embed><p>Sicuro</p>' },
  { name: 'remove-meta-with-content', input: '<meta name="x">payload</meta><p>Sicuro</p>' },
  { name: 'remove-link-with-content', input: '<link href="x">payload</link><p>Sicuro</p>' },
  {
    name: 'strip-hostile-allowed-attributes',
    input: '<p style="color:red" onclick="alert(1)"><strong data-x="1">Contenuto</strong></p>',
  },
  {
    name: 'strip-hostile-void-attributes',
    input: '<p>Prima<img/src=x onerror=alert(1)>Dopo</p>',
  },
  { name: 'strip-href-wrapper', input: '<p><a href="javascript:alert(1)">Testo</a></p>' },
  {
    name: 'nested-lists',
    input: '<ul><li>Esami<ul><li>Emocromo</li><li>Creatinina</li></ul></li><li>Controllo</li></ul>',
  },
  {
    name: 'nested-blockquotes',
    input: '<blockquote><p>Caregiver</p><blockquote><p>Paziente</p></blockquote></blockquote>',
  },
  { name: 'heading-h4-not-allowed', input: '<h4>Heading degradato</h4>' },
  { name: 'residual-less-than', input: 'Dose < 5 mg e valore > 2' },
  { name: 'html-entities', input: '<p>&amp; &lt; &gt; &quot; &#39; &nbsp;</p>' },
  { name: 'malformed-unclosed-allowed-tag', input: '<p><strong>Valore non chiuso' },
  { name: 'malformed-crossed-nesting', input: '<p><strong>Incrocio</p></strong>' },
  { name: 'unicode-and-emoji', input: '<p>Febbre 38,5 °C • caffè 🩺 👩‍⚕️</p>' },
  {
    name: 'long-multi-block-content',
    input: '<h2>Follow-up complesso</h2><p><strong>Sintesi:</strong> quadro stabile con monitoraggio domiciliare.</p><ul><li>Pressione mattino e sera</li><li>Controllo esami tra 7 giorni</li></ul><blockquote><p>Segnalare subito nuovi sintomi respiratori o neurologici.</p></blockquote><p><em>Rivalutazione programmata.</em></p>',
  },
  { name: 'native-soap-template', input: soapTemplate },
  {
    name: 'non-idempotent-nested-empty-block',
    input: '<p><p></p></p><p>Uno<br><br><br><br>Due</p>',
  },
];

const fixtures = cases.map(({ name, input }) => ({
  name,
  input,
  sanitized: sanitizeClinicalRichTextHtml(input),
}));

// Divergenze di idempotenza gia note del sanitizer web: la fixture resta nel
// set (la parita Swift si misura sul primo passaggio, che e cio che il DB
// persiste), ma solo una divergenza NUOVA deve far fallire la generazione.
const knownIdempotenceDivergences = new Set(['non-idempotent-nested-empty-block']);

const idempotenceFindings = [];
for (const fixture of fixtures) {
  try {
    assert.equal(
      sanitizeClinicalRichTextHtml(fixture.sanitized),
      fixture.sanitized,
      `web sanitizer is not idempotent for ${fixture.name}`,
    );
  } catch (error) {
    idempotenceFindings.push({ name: fixture.name, message: error.message });
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');

console.log(`Generated ${fixtures.length} clinical rich-text fixtures at ${path.relative(process.cwd(), outputPath)}.`);
const unexpectedFindings = idempotenceFindings.filter((finding) => !knownIdempotenceDivergences.has(finding.name));
const missingKnown = [...knownIdempotenceDivergences].filter(
  (name) => !idempotenceFindings.some((finding) => finding.name === name),
);
if (idempotenceFindings.length > 0) {
  console.error('Web sanitizer idempotence findings:');
  for (const finding of idempotenceFindings) {
    const label = knownIdempotenceDivergences.has(finding.name) ? 'known' : 'NEW';
    console.error(`- [${label}] ${finding.message}`);
  }
}
if (missingKnown.length > 0) {
  console.log(`Known divergences no longer reproduced (prune the allowlist): ${missingKnown.join(', ')}`);
}
if (unexpectedFindings.length > 0) {
  process.exitCode = 1;
} else {
  console.log('Web sanitizer idempotence: no unexpected divergences.');
}
