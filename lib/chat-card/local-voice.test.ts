import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const html = readFileSync(join(root, 'lib/chat-card/native-access.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)![1];

test('voice command opens only the native review and rejects unexpected transcript payloads', async () => {
    assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
    const elements = new Map<string, any>();
    for (const id of html.matchAll(/id="([^"]+)"/gu)) elements.set(id[1], { disabled: true, hidden: true, value: '', textContent: '', replaceChildren() {} });
    let onMessage: any;
    const commands: any[] = [];
    let openingMeta: any = { status: 'voice-opened' };
    const parent = { postMessage(message: any) {
        if (!message.id) return;
        if (message.params?.arguments) commands.push(message.params.arguments);
        const result = message.method === 'ui/initialize' ? {} : { _meta: message.params?.arguments?.command === 'attach' ? { status: 'ready' } : openingMeta };
        queueMicrotask(() => onMessage({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } }));
    } };
    vm.runInNewContext(script, {
        document: { getElementById: (id: string) => elements.get(id), documentElement: { scrollHeight: 400 } },
        window: { parent, addEventListener: (name: string, cb: any) => { if (name === 'message') onMessage = cb; } },
        requestAnimationFrame: (cb: any) => cb(), setTimeout, clearTimeout,
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('local-voice').disabled, false);
    elements.get('local-voice').onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ command: 'attach' }, { command: 'local-voice' }]);
    assert.match(elements.get('status').textContent, /Continua in MediFlow/u);
    assert.equal(elements.get('consume').disabled, true);
    assert.equal(elements.get('card').hidden, true);
    openingMeta = { status: 'voice-opened', transcript: 'Nome inventato Ada Esempio' };
    const second = new Map([...elements].map(([id, element]) => [id, { ...element, disabled: true, textContent: '' }]));
    const original = elements;
    for (const [id, element] of second) original.set(id, element);
    vm.runInNewContext(script, {
        document: { getElementById: (id: string) => original.get(id), documentElement: { scrollHeight: 400 } },
        window: { parent, addEventListener: (name: string, cb: any) => { if (name === 'message') onMessage = cb; } },
        requestAnimationFrame: (cb: any) => cb(), setTimeout, clearTimeout,
    });
    await new Promise(resolve => setImmediate(resolve));
    original.get('local-voice').onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(original.get('status').textContent, /Apertura non confermata/u);
    assert.ok(!original.get('status').textContent.includes('Ada'));
});

// WUL-828: la dettatura usa solo whisper. Nel codice non resta il motore
// vocale Apple; le note storiche nei docs restano.
const appleSpeechEngine = /\bimport\s+Speech\b|SFSpeech\w*|SpeechAnalyzer|SpeechTranscriber|DictationTranscriber|AssetInventory|NSSpeechRecognitionUsageDescription|webkitSpeechRecognition|\bSpeechRecognition\b|MFVoiceCreate|ChatLocalVoice|local_voice_apple|trascrizione Apple/u;
const codeRoots = ['app', 'components', 'hooks', 'lib', 'packages', 'scripts', 'e2e', 'contracts', 'plugins', 'tools', '.github', 'experiments/gpui-patient-pilot', 'native'];
const skippedDirectories = new Set(['node_modules', 'target', '.next', '.build', 'build', 'DerivedData']);
const codeExtensions = /\.(?:swift|rs|m|h|ts|tsx|mts|js|mjs|cjs|json|ya?ml|plist|entitlements|pbxproj|toml|sh|py)$/u;

function codeFiles(directory: string, found: string[] = []): string[] {
    let entries: Dirent[];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return found; }
    for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!skippedDirectories.has(entry.name)) codeFiles(full, found);
        } else if (entry.isFile() && codeExtensions.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

test('no Apple speech engine is left in the code: dictation is whisper only', () => {
    const self = resolve(import.meta.filename);
    const files = codeRoots.flatMap(directory => codeFiles(join(root, directory)));
    assert.ok(files.some(file => file.endsWith('local_voice/whisper.rs')), 'whisper engine not scanned');
    assert.ok(files.some(file => file.endsWith('PairedPatientsWorkspaceView.swift')), 'Apple client not scanned');
    const hits = files
        .filter(file => file !== self)
        .flatMap(file => readFileSync(file, 'utf8').split('\n')
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => appleSpeechEngine.test(line))
            .map(({ line, index }) => `${relative(root, file)}:${index + 1}: ${line.trim()}`));
    assert.deepEqual(hits, []);
});
