import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
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

test('shared Apple capture uses a synthetic runtime double: denial, missing local assets, review and cancellation', { skip: process.platform !== 'darwin', timeout: 90_000 }, t => {
    const version = spawnSync('xcrun', ['swiftc', '--version'], { encoding: 'utf8' });
    const swift = /Swift version (\d+)\.(\d+)/u.exec(version.stdout || version.stderr);
    if (version.status !== 0 || !swift || Number(swift[1]) < 6 || (Number(swift[1]) === 6 && Number(swift[2]) < 2)) {
        t.skip('Swift 6.2 and macOS 26 SDK required for the Apple runtime');
        return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mediflow-chat-voice-'));
    try {
        const harness = join(dir, 'harness.swift');
        writeFileSync(harness, `
import Foundation
@MainActor final class Permission: VisitRecordingPermissionPort {
    let granted: Bool
    init(_ granted: Bool) { self.granted = granted }
    func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void) { completion(granted) }
}
@MainActor final class Assets: VisitRecordingAssetPort {
    var isAvailable = true
    var maximumReservedLocales = 8
    var installed = true
    var installations = 0
    func resolveLocale(equivalentTo locale: Locale) async -> Locale? { locale }
    func installedLocales() async -> [Locale] { installed ? [Locale(identifier: "it-IT")] : [] }
    func reservedLocales() async -> [Locale] { [] }
    func status() async -> VisitRecordingAssetStatus { installed ? .installed : .supported }
    func installationRequest() async throws -> VisitRecordingAssetInstallation? { installations += 1; return nil }
    func reserve(locale: Locale) async throws -> Bool { true }
    func release(locale: Locale) async -> Bool { true }
}
@MainActor final class Runtime: VisitRecordingRuntimePort {
    var starts = 0
    var cancels = 0
    var final = true
    var result: (@MainActor @Sendable (VisitRecordingTranscriptResult) -> Void)?
    func prepare(audioBudget: VisitRecordingAudioBudget,
                 onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
                 onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
                 onInterruption: @escaping @Sendable () -> Void,
                 onFailure: @escaping @Sendable (VisitRecordingDenial) -> Void) async throws { result = onResult }
    func startCapture() throws { starts += 1 }
    func consume(_ frame: VisitRecordingPCMFrame) async throws {}
    func stopCapture() {}
    func finishAndFinalize() async throws { result?(.init(text: "Nome inventato Ada Esempio. Controllo sintetico.", isFinal: final)) }
    func cancelAndFinishNow() async { cancels += 1 }
}
@main struct Harness {
    @MainActor static func main() async throws {
        for (granted, installed, expected) in [(false, true, ChatLocalVoice.State.permissionDenied), (true, false, .unavailable)] {
            let assets = Assets(); assets.installed = installed
            let runtime = Runtime()
            let voice = ChatLocalVoice(makePreflight: { VisitRecordingPreflight(permission: Permission(granted), assets: assets) },
                makeCapture: { reference, _, current in try? VisitRecordingCaptureController(selectionReference: reference, runtime: runtime, currentSelectionReference: current) })
            await voice.start()
            precondition(voice.poll() == expected && voice.transcript == nil && runtime.starts == 0 && assets.installations == 0)
            await voice.cancel()
        }
        let assets = Assets(), runtime = Runtime()
        let voice = ChatLocalVoice(makePreflight: { VisitRecordingPreflight(permission: Permission(true), assets: assets) },
            makeCapture: { reference, _, current in try? VisitRecordingCaptureController(selectionReference: reference, runtime: runtime, currentSelectionReference: current) })
        await voice.start()
        precondition(voice.poll() == .recording && voice.transcript == nil && runtime.starts == 1)
        await voice.stop()
        precondition(voice.poll() == .review)
        precondition(voice.transcript == "Nome inventato Ada Esempio. Controllo sintetico.")
        voice.invalidate()
        precondition(voice.transcript == nil && voice.poll() == .cancelled)
        await voice.cancel()
        let partial = Runtime(); partial.final = false
        let unfinished = ChatLocalVoice(makePreflight: { VisitRecordingPreflight(permission: Permission(true), assets: assets) },
            makeCapture: { reference, _, current in try? VisitRecordingCaptureController(selectionReference: reference, runtime: partial, currentSelectionReference: current) })
        await unfinished.start(); await unfinished.stop()
        precondition(unfinished.transcript == nil && unfinished.poll() == .unavailable)
        await unfinished.cancel()
        print("synthetic-port: permission-denied, assets-missing, no-download, no-early-text, final-review, identifiers-native, cancellation, non-final-denied")
    }
}
`);
        const sources = [
            'native/MediFlowMac/Sources/MediFlowCore/VisitRecordingStateContract.swift',
            'native/MediFlowMac/Sources/MediFlowAppleShared/VisitRecordingPreflight.swift',
            'native/MediFlowMac/Sources/MediFlowAppleShared/VisitRecordingCapture.swift',
            'native/MediFlowMac/Sources/MediFlowAppleShared/AppleVisitRecordingRuntime.swift',
            'experiments/gpui-patient-pilot/app/src/local_voice/bridge.swift',
        ];
        const executable = join(dir, 'voice-test');
        const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', ...sources, harness, '-o', executable], { cwd: root, encoding: 'utf8', timeout: 70_000 });
        assert.equal(build.status, 0, build.stderr);
        const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /synthetic-port: permission-denied/u);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
