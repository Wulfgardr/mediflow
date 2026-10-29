import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-specialist-falsification-'));
const results = [];
const suite = 'lib/local-operation/specialist/vertical.test.ts';
function run(label, file, expected, pattern) {
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--test', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), file],
        { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, MEDIFLOW_DATA_DIR: owned } });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, `${label}: execution error`);
    assert.equal(result.status, expected, `${label}: unexpected exit\n${output}`);
    assert.match(output, expected === 0 ? /fail 0/ : /la conferma CU richiede la prescrizione registrata|Missing expected exception|Missing expected rejection|Expected values to be strictly equal|Expected values to be strictly deep-equal|WebSocket fuori manifest non deve raggiungere il destinatario|tipo e collocazione richiedono classificazione esplicita|revoca interrompe HTTP già in corso/, `${label}: semantic assertion required\n${output}`);
    results.push({ label, exitCode: result.status, output }); console.log(`${label}: PASS (exit ${result.status} atteso)`);
}
function mutate(label, relative, before, after, pattern, testFile = suite) {
    const directory = path.join(owned, label); fs.mkdirSync(directory);
    for (const subtree of ['lib', 'packages']) fs.cpSync(path.join(root, subtree), path.join(directory, subtree), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const file = path.join(directory, relative), original = fs.readFileSync(file, 'utf8');
    assert.equal(original.split(before).length, 2, `${label}: mutation drift`);
    fs.writeFileSync(file, original.replace(before, after));
    run(label, path.join(directory, testFile), 1, pattern);
}
try {
    run('specialist-baseline', suite, 0);
    mutate('exemption-applicability', 'lib/local-operation/specialist/prescription.ts', '!exemption.applicableCodes.includes(item.code)', 'false',
        'titolo presente', 'lib/local-operation/specialist/prescription.test.ts');
    mutate('unknown-field', 'lib/local-operation/specialist/browser-adapter.ts', "unclassifiedFields: complete ? unknown : [...unknown, 'invalid-field-set']", 'unclassifiedFields: []', 'istruzione ostile');
    mutate('page-network-guard', 'lib/local-operation/specialist/browser-adapter.ts', 'active.ctx.authorizeRequest(destination);', '', 'autorizzazione richiesta');
    mutate('browser-retry', 'lib/local-operation/specialist/browser-adapter.ts', 'maxRetries: 0', 'maxRetries: 1', 'timeout dopo atto');
    mutate('atomic-recipient', 'lib/local-operation/specialist/synthetic-portal.ts', '!valuesMatch(body, state.plan)', 'false', 'corsa umana');
    mutate('outcome-connection', 'lib/local-operation/sqlite-journal.ts', 'ports.recordConfirmed?.(record)', 'undefined', 'HTML, rilettura');
    mutate('required-audit', 'lib/local-operation/specialist/outcome-service.ts',
        "if (audit.changes !== 1 || !db.prepare('SELECT 1 FROM audit_events WHERE event_id=?').get(eventId)) deny();", '', 'audit ignorato');
    mutate('websocket-deny', 'lib/local-operation/specialist/browser-adapter.ts', "await context.routeWebSocket('**/*', socket => { void socket.close(); });", '', 'WebSocket senza CSP');
    mutate('close-on-revoke', 'lib/local-operation/specialist/browser-adapter.ts', 'page.close(), ', '', 'revoca chiude un canale');
    mutate('worker-deny', 'lib/local-operation/specialist/browser-adapter.ts', "['Worker', 'SharedWorker', 'RTCPeerConnection', 'WebTransport']", '[]', 'worker e trasporti');
    mutate('resource-channel', 'lib/local-operation/specialist/browser-adapter.ts', "request.resourceType() !== 'document' || ", '', 'risorsa con URL');
    mutate('control-inventory', 'lib/local-operation/specialist/browser-adapter.ts', "input, textarea, select, button, [contenteditable]:not([contenteditable=\"false\"])", 'input, button', 'controllo inatteso <textarea|controllo inatteso <select|controllo inatteso <div');
    mutate('control-type', 'lib/local-operation/specialist/browser-adapter.ts', "field.type !== 'text' || ", '', 'input noto con type');
    mutate('control-placement', 'lib/local-operation/specialist/browser-adapter.ts', '|| !field.placed', '', 'input noto con form');
    mutate('http-close-on-revoke', 'lib/local-operation/specialist/browser-adapter.ts', '...[...transports].map(transport => transport.dispose())', '', 'revoca interrompe HTTP');
    run('specialist-restored', suite, 0);
    if (process.env.MEDIFLOW_CU_EVIDENCE) {
        assert.ok(path.isAbsolute(process.env.MEDIFLOW_CU_EVIDENCE));
        fs.writeFileSync(process.env.MEDIFLOW_CU_EVIDENCE, JSON.stringify(results, null, 2));
    }
} finally { fs.rmSync(owned, { recursive: true, force: true }); }
