/* @Codex */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createAppleVisionOcrProcessRunner } from './local-ocr-apple-vision-process-runner.ts';

class Child extends EventEmitter {
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly kills: string[] = [];
    kill(signal?: NodeJS.Signals) { this.kills.push(signal ?? ''); return true; }
}

function harness(options: Readonly<{ cleanupFails?: boolean; directoryMode?: number; directorySymlink?: boolean; spawnThrows?: boolean; uid?: number }> = {}) {
    const children: Child[] = []; const spawns: unknown[][] = []; const removals: string[] = [];
    let timeout: (() => void) | undefined;
    const runner = createAppleVisionOcrProcessRunner({
        platform: () => 'darwin',
        uid: () => options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined),
        spawn: (...args: unknown[]) => { if (options.spawnThrows) throw new Error('launch'); spawns.push(args); const child = new Child(); children.push(child); return child; },
        chmod: async () => undefined,
        lstat: async (path: string) => ({ isDirectory: () => true, isFile: () => true, isSymbolicLink: () => path === '/tmp/ocr-test' && Boolean(options.directorySymlink), mode: path === '/tmp/ocr-test' ? (options.directoryMode ?? 0o700) : 0o600, uid: typeof process.getuid === 'function' ? process.getuid() : undefined }),
        mkdtemp: async () => '/tmp/ocr-test',
        open: async () => ({ writeFile: async () => undefined, close: async () => undefined }),
        rm: async (path: string) => { removals.push(path); if (options.cleanupFails) throw new Error('cleanup'); },
        setTimer: (callback: () => void) => { timeout = callback; return {}; },
        clearTimer: () => undefined,
    });
    const start = async () => {
        const pending = runner.run({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' });
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
        const child = children.at(-1); if (!child) throw new Error('child not started');
        return { child, pending };
    };
    return { children, spawns, removals, run: () => runner.run({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' }), runWith: (value: unknown) => runner.run(value), start, timeout: () => timeout };
}

test('uses one fixed Swift invocation and cleans the private directory after success', async () => {
    const subject = harness(); const run = await subject.start();
    assert.equal(subject.spawns.length, 1);
    assert.equal(subject.spawns[0]?.[0], '/usr/bin/swift');
    assert.deepEqual(subject.spawns[0]?.[2], { cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    assert.match(String((subject.spawns[0]?.[1] as string[])[0]), /scripts\/apple-vision-ocr\.swift$/);
    assert.equal((subject.spawns[0]?.[1] as string[])[1], '/tmp/ocr-test/input.png');
    run.child.stdout.emit('data', Buffer.from('synthetic raw OCR'));
    run.child.emit('close', 0, null);
    assert.deepEqual(await run.pending, { status: 'succeeded', output: 'synthetic raw OCR' });
    assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
});

test('fails closed without invocation when the private directory mode is not 0700', async () => {
    const subject = harness({ directoryMode: 0o755 });
    const pending = subject.run();
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    assert.deepEqual(subject.spawns, []);
    assert.deepEqual(await pending, { status: 'failed' });
    assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
});

test('fails closed for a symlinked or foreign temporary directory and malformed inputs', async () => {
    for (const subject of [harness({ directorySymlink: true }), harness({ uid: -1 })]) {
        assert.deepEqual(await subject.run(), { status: 'failed' });
        assert.deepEqual(subject.spawns, []);
        assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
    }
    const subject = harness();
    const runner = createAppleVisionOcrProcessRunner(new Proxy({} as never, {}));
    const accessor = Object.defineProperty({}, 'payload', { enumerable: true, get: () => 'iVBORw0KGgo=' });
    Object.defineProperty(accessor, 'mimeType', { enumerable: true, value: 'image/png' });
    assert.deepEqual(await runner.run({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' }), { status: 'failed' });
    assert.deepEqual(await subject.runWith(accessor), { status: 'failed' });
    assert.deepEqual(await subject.runWith(Object.create({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' })), { status: 'failed' });
    assert.deepEqual(subject.spawns, []);
});

test('fails closed for launch, child, overflow, timeout, late output, and cleanup failures', async () => {
    const launch = harness({ spawnThrows: true });
    assert.deepEqual(await launch.run(), { status: 'failed' });
    assert.equal(launch.spawns.length, 0);
    const cases = [
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('error', new Error('synthetic')); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('close', 2, null); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('close', null, 'SIGTERM'); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.stdout.emit('data', Buffer.alloc(32 * 1024 + 1)); assert.deepEqual(run.child.kills, ['SIGKILL']); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.stderr.emit('data', Buffer.alloc(32 * 1024 + 1)); assert.deepEqual(run.child.kills, ['SIGKILL']); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { subject.timeout()?.(); assert.deepEqual(run.child.kills, ['SIGKILL']); run.child.stdout.emit('data', Buffer.from('late')); run.child.emit('close', 0, null); },
    ];
    for (const close of cases) {
        const subject = harness(); const run = await subject.start(); await close(subject, run);
        assert.deepEqual(await run.pending, { status: 'failed' });
        assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
    }
    const subject = harness({ cleanupFails: true }); const run = await subject.start();
    run.child.stdout.emit('data', Buffer.from('synthetic raw OCR')); run.child.emit('close', 0, null);
    assert.deepEqual(await run.pending, { status: 'failed' });
});
