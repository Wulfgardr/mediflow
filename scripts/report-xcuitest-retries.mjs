import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function children(node) {
  if (!node || typeof node.nodeType !== 'string' || typeof node.name !== 'string'
    || (node.children !== undefined && !Array.isArray(node.children))) {
    throw new Error('Nodo xcresult non riconosciuto');
  }
  return node.children ?? [];
}

function descendants(node, type) {
  const nested = children(node);
  return node.nodeType === type ? [node] : nested.flatMap(child => descendants(child, type));
}

function errors(node) {
  const messages = descendants(node, 'Failure Message').map(message => message.name);
  if (node.result === 'Skipped' && messages.every(message => message.startsWith('Test skipped - '))) return [];
  return messages;
}

function infrastructure(message) {
  if (/XCTAssert|XCTFail|Expectation failed|Assertion Failure/iu.test(message)) return false;
  return /(?:^|: )Failed to get background assertion\b/u.test(message)
    || /(?:^|: )(?:Failed to boot simulator|Unable to boot (?:the )?Simulator)\b/iu.test(message);
}

function cell(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;').replace(/\r?\n/gu, '<br>');
}

// xcresulttool get test-results tests exposes every attempt as a Repetition,
// including recovered failures whose parent still has result=Failed.
export function retryReport(data) {
  if (!Array.isArray(data?.testNodes)) throw new Error('testNodes assente nel risultato xcresult');
  const cases = data.testNodes.flatMap(node => descendants(node, 'Test Case'));
  if (!cases.length) throw new Error('Nessun test nel risultato xcresult');
  const rows = [];
  let failed = false;
  for (const test of cases) {
    const repetitions = children(test).flatMap(node => descendants(node, 'Repetition'));
    const attempts = repetitions.length ? repetitions : [test];
    if (attempts.some(node => !['Passed', 'Failed', 'Skipped', 'Expected Failure'].includes(node.result))) {
      throw new Error(`Esito non riconosciuto: ${test.nodeIdentifier ?? test.name}`);
    }
    const failures = attempts.filter(node => node.result === 'Failed');
    const attemptMessages = failures.flatMap(errors);
    const messages = [...attemptMessages, ...errors(test).filter(message => !attemptMessages.includes(message))];
    const recovered = failures.length > 0 && attempts.at(-1).result === 'Passed';
    const infraOnly = failures.length > 0 && messages.every(infrastructure) && failures.every(node => {
      const signatures = errors(node);
      return signatures.length > 0 && signatures.every(infrastructure);
    });
    const accepted = (failures.length === 0 && messages.length === 0) || (recovered && infraOnly);
    if (!accepted) failed = true;
    if (attempts.length > 1 || !accepted) {
      rows.push([
        test.nodeIdentifier ?? test.name,
        attempts.map(node => node.result).join(' → '),
        recovered ? 'riuscito dopo un fallimento' : attempts.at(-1).result,
        messages[0] || 'Firma del primo errore assente',
        messages.slice(1).join('\n') || '',
        accepted ? (infraOnly ? 'infrastruttura' : 'nessun fallimento') : 'BLOCCATO: prodotto o errore non riconosciuto',
      ].map(cell).join(' | '));
    }
  }
  const markdown = rows.length
    ? `| Test | Tentativi | Esito finale | Primo errore | Altri errori | Valutazione |\n| --- | --- | --- | --- | --- | --- |\n${rows.map(row => `| ${row} |`).join('\n')}\n`
    : 'Nessun test ripetuto e nessun fallimento.\n';
  return { failed, markdown: `${cases.length} test letti dall'xcresult.\n\n${markdown}` };
}

function extractBundle(bundle) {
  if (!existsSync(bundle)) throw new Error(`Bundle xcresult assente: ${bundle}`);
  return execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function writeRetryReport(bundle, { extract = extractBundle, summary = process.env.GITHUB_STEP_SUMMARY } = {}) {
  let report;
  try {
    const raw = extract(bundle);
    writeFileSync(`${bundle}.tests.json`, raw);
    report = retryReport(JSON.parse(raw));
  } catch (error) {
    report = { failed: true, markdown: `Impossibile verificare i tentativi: ${cell(error.message)}\n` };
  }
  const markdown = `\n### XCUITest ${cell(process.env.IDIOM ?? '')}: tentativi e primi errori\n\n${report.markdown}`;
  writeFileSync(`${bundle}.retries.md`, markdown);
  if (summary) appendFileSync(summary, markdown);
  return { ...report, markdown };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Uso: node scripts/report-xcuitest-retries.mjs <bundle.xcresult>');
    process.exitCode = 1;
  } else {
    const report = writeRetryReport(process.argv[2]);
    console.log(report.markdown);
    process.exitCode = report.failed ? 1 : 0;
  }
}
