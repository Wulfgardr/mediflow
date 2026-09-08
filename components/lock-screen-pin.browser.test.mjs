/* @Codex WUL-675 — HTML-ONLY component projection, NOT an integrated login test.
 * Real Chromium exercises input attributes read from the actual TSX AST.
 * React, SecurityProvider, callbacks, recovery state and crypto are NOT mounted.
 * Submission is recorded locally; it never represents an authenticated session.
 * Run: node --test components/lock-screen-pin.browser.test.mjs
 * Defaults: already-installed typescript, @playwright/test and its Chromium.
 * Offline tooling may be selected explicitly using MEDIFLOW_PIN_PLAYWRIGHT_MODULE
 * and MEDIFLOW_PIN_BROWSER_EXECUTABLE. No downloads or dependency installation.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { chromium } = require(process.env.MEDIFLOW_PIN_PLAYWRIGHT_MODULE || '@playwright/test');
const sourceRoot = resolve(process.env.MEDIFLOW_PIN_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const declarations = [
  ['components/lock-screen.tsx', ['unlock-or-legacy-setup', 'legacy-setup-confirmation']],
  ['components/onboarding-wizard.tsx', ['onboarding-pin', 'onboarding-confirmation']],
  ['components/intelligent-host-checkup-action.tsx', ['fresh-checkup-pin']],
];
const attributeMap = new Map([
  ['type', 'type'], ['inputMode', 'inputmode'], ['pattern', 'pattern'],
  ['minLength', 'minlength'], ['maxLength', 'maxlength'],
  ['required', 'required'], ['autoComplete', 'autocomplete'],
]);
function escapeAttribute(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}
function literalAttribute(attribute) {
  if (!attribute.initializer) return true;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer)) {
    const expression = attribute.initializer.expression;
    if (expression && (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression))) return expression.text;
    if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  throw new Error(`HTML fixture cannot project dynamic constraint ${attribute.name.getText()}; use a mounted component test.`);
}
function readInputs(file, names) {
  const source = readFileSync(resolve(sourceRoot, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(tree.parseDiagnostics.length, 0, `${file}: TSX parse errors`);
  const inputs = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      // Do not let a form-level validation opt-out make this projection falsely green.
      if (['form', 'input', 'button'].includes(tag)) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && ['noValidate', 'formNoValidate'].includes(attribute.name.getText(tree))) {
            assert.equal(literalAttribute(attribute), false, `${file}: native form validation must remain enabled`);
          }
        }
      }
      if (tag === 'input') {
        const type = node.attributes.properties.find(attribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'type');
        if (type && literalAttribute(type) === 'password') {
          assert.ok(node.attributes.properties.every(attribute => !ts.isJsxSpreadAttribute(attribute)),
            `${file}: spread props require a mounted component test, not a partial projection`);
          const attributes = [];
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute)) continue;
            const name = attributeMap.get(attribute.name.getText(tree));
            if (!name) continue;
            const value = literalAttribute(attribute);
            if (value !== false) attributes.push(value === true ? name : `${name}="${escapeAttribute(value)}"`);
          }
          inputs.push(attributes.join(' '));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(inputs.length, names.length, `${file}: every expected masked PIN input must be covered`);
  const sha256 = createHash('sha256').update(source).digest('hex');
  return inputs.map((attributes, index) => ({ file, name: names[index], attributes, sha256 }));
}
const inputs = declarations.flatMap(([file, names]) => readInputs(file, names));
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDIFLOW_PIN_BROWSER_EXECUTABLE
      ? { executablePath: process.env.MEDIFLOW_PIN_BROWSER_EXECUTABLE } : {}),
  });
});
after(async () => { await browser?.close(); });

for (const input of inputs) {
  test(`HTML-only projection: ${input.name} accepts unchanged PINs and native Enter submission`, async t => {
    const context = await browser.newContext();
    try {
      // No application, network backend, route substitutions or login success in this fixture.
      await context.setOffline(true);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
        <title>PIN parity HTML-only fixture</title></head><body>
        <h1>HTML-only PIN fixture — no authentication</h1>
        <form id="fixture"><label for="candidate">Synthetic PIN</label>
          <input id="candidate" ${input.attributes}>
          <button type="submit">Record local submission</button>
        </form><output id="submissions"></output>
        <script>
          window.localSubmissions = [];
          document.querySelector('#fixture').addEventListener('submit', event => {
            event.preventDefault();
            window.localSubmissions.push(document.querySelector('#candidate').value);
            document.querySelector('#submissions').textContent = String(window.localSubmissions.length);
          });
        </script></body></html>`);
      assert.equal(await page.title(), 'PIN parity HTML-only fixture');
      const field = page.locator('#candidate');
      assert.equal(await field.getAttribute('type'), 'password');
      // Numeric control, then the exact original regression; additional strings catch restrictions.
      for (const pin of ['086086', 'demo086086', 'AbC!09', ' demo086086 ']) {
        await field.fill(pin);
        const beforeCount = await page.evaluate(() => window.localSubmissions.length);
        const validity = await field.evaluate(element => ({
          valid: element.checkValidity(), patternMismatch: element.validity.patternMismatch,
          validationEnabled: element.form.noValidate === false,
        }));
        await field.press('Enter');
        const submitted = await page.evaluate(() => window.localSubmissions);
        t.diagnostic(JSON.stringify({ fixture: 'HTML-only', input: input.name, source: input.file,
          sourceSHA256: input.sha256, browser: browser.version(), node: process.versions.node,
          typescript: ts.version, candidate: pin === 'demo086086' ? 'original-demo086086' : 'synthetic-control',
          ...validity, submitDelta: submitted.length - beforeCount,
          submittedUnchanged: submitted[beforeCount] === pin }));
        assert.deepEqual(validity, { valid: true, patternMismatch: false, validationEnabled: true });
        assert.equal(submitted.length, beforeCount + 1);
        assert.equal(submitted[beforeCount], pin);
        assert.equal(await field.inputValue(), pin);
      }
      assert.equal(await field.getAttribute('inputmode'), 'text');
      // Browser-native constraints on another field must still block the form, including Enter.
      await page.locator('#fixture').evaluate(form => {
        const email = document.createElement('input');
        email.type = 'email'; email.required = true; email.value = 'not-an-email';
        form.append(email);
      });
      const count = await page.evaluate(() => window.localSubmissions.length);
      await field.press('Enter');
      assert.equal(await page.evaluate(() => window.localSubmissions.length), count);
      assert.equal(await page.locator('#fixture').evaluate(form => form.checkValidity()), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
