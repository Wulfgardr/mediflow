/* @Codex */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createAppleVisionOcrProcessRunner } from './local-ocr-apple-vision-process-runner.ts';

class Child extends EventEmitter {
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly kills: string[] = [];
    constructor(private readonly killResult = true) { super(); }
    kill(signal?: NodeJS.Signals) { this.kills.push(signal ?? ''); return this.killResult; }
}

function facade<T extends object>(value: T): T { return Object.freeze(Object.assign(Object.create(null), value)); }

function assertResult(value: unknown, status: 'failed' | 'succeeded', output?: string) {
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(value), true);
    assert.equal((value as { status?: string }).status, status);
    assert.equal((value as { output?: string }).output, output);
}

function harness(options: Readonly<{ cleanupFails?: boolean; directoryMode?: number; directorySymlink?: boolean; fileMode?: number; fileSymlink?: boolean; fileUid?: number; killFalse?: boolean; missingUid?: boolean; platformThrows?: boolean; setTimerThrows?: boolean; spawnThrows?: boolean; uid?: number }> = {}) {
    const children: Child[] = []; const spawns: unknown[][] = []; const removals: string[] = [];
    let timeout: (() => void) | undefined;
    const runner = createAppleVisionOcrProcessRunner({
        platform: () => { if (options.platformThrows) throw new Error('platform'); return 'darwin'; },
        uid: () => options.missingUid ? undefined : (options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)),
        spawn: (...args: unknown[]) => { if (options.spawnThrows) throw new Error('launch'); spawns.push(args); const child = new Child(!options.killFalse); children.push(child); return child; },
        chmod: async () => undefined,
        lstat: async (path: string) => {
            const input = path.startsWith('/tmp/ocr-test/input.');
            return facade({ isDirectory: () => true, isFile: () => true, isSymbolicLink: () => path === '/tmp/ocr-test' ? Boolean(options.directorySymlink) : (input && Boolean(options.fileSymlink)), mode: path === '/tmp/ocr-test' ? (options.directoryMode ?? 0o700) : (input ? (options.fileMode ?? 0o600) : 0o600), uid: path === '/tmp/ocr-test' ? (typeof process.getuid === 'function' ? process.getuid() : undefined) : (input ? (options.fileUid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)) : (typeof process.getuid === 'function' ? process.getuid() : undefined)) });
        },
        mkdtemp: async () => '/tmp/ocr-test',
        open: async () => facade({ writeFile: async () => undefined, close: async () => undefined }),
        rm: async (path: string) => { removals.push(path); if (options.cleanupFails) throw new Error('cleanup'); },
        setTimer: (callback: () => void) => { if (options.setTimerThrows) throw new Error('timer'); timeout = callback; return {}; },
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
    assertResult(await run.pending, 'succeeded', 'synthetic raw OCR');
    assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
});

test('fails closed without invocation when the private directory mode is not 0700', async () => {
    const subject = harness({ directoryMode: 0o755 });
    const pending = subject.run();
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    assert.deepEqual(subject.spawns, []);
    assertResult(await pending, 'failed');
    assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
});

test('fails closed for a symlinked or foreign temporary directory and malformed inputs', async () => {
    for (const [subject, removals] of [[harness({ directorySymlink: true }), ['/tmp/ocr-test']], [harness({ uid: -1 }), ['/tmp/ocr-test']], [harness({ missingUid: true }), []], [harness({ fileUid: -1 }), ['/tmp/ocr-test']], [harness({ fileMode: 0o644 }), ['/tmp/ocr-test']], [harness({ fileSymlink: true }), ['/tmp/ocr-test']]] as const) {
        assertResult(await subject.run(), 'failed');
        assert.deepEqual(subject.spawns, []);
        assert.deepEqual(subject.removals, removals);
    }
    const subject = harness();
    const runner = createAppleVisionOcrProcessRunner(new Proxy({} as never, {}));
    const accessor = Object.defineProperty({}, 'payload', { enumerable: true, get: () => 'iVBORw0KGgo=' });
    Object.defineProperty(accessor, 'mimeType', { enumerable: true, value: 'image/png' });
    assertResult(await runner.run({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' }), 'failed');
    assertResult(await subject.runWith(accessor), 'failed');
    assertResult(await subject.runWith(Object.create({ mimeType: 'image/png', payload: 'iVBORw0KGgo=' })), 'failed');
    assert.deepEqual(subject.spawns, []);
});

test('contains a throwing platform facade and returns a frozen failed result', async () => {
    assertResult(await harness({ platformThrows: true }).run(), 'failed');
});

test('waits for a terminal child event after timer failure or a refused kill', async () => {
    const timer = harness({ setTimerThrows: true }); const timerRun = await timer.start();
    assert.deepEqual(timerRun.child.kills, ['SIGKILL']);
    assert.deepEqual(timer.removals, []);
    timerRun.child.emit('close', null, 'SIGKILL');
    assertResult(await timerRun.pending, 'failed');
    assert.deepEqual(timer.removals, ['/tmp/ocr-test']);

    const refused = harness({ killFalse: true }); const refusedRun = await refused.start();
    refusedRun.child.stdout.emit('data', Buffer.alloc(32 * 1024 + 1));
    refused.timeout()?.();
    assert.deepEqual(refusedRun.child.kills, ['SIGKILL']);
    assert.deepEqual(refused.removals, []);
    refusedRun.child.emit('close', 0, null);
    assertResult(await refusedRun.pending, 'failed');
    assert.deepEqual(refused.removals, ['/tmp/ocr-test']);
});

test('does not read an ambient then getter for safe facade results or runner output', async () => {
    let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { reads += 1; return undefined; } });
    try {
        const subject = harness(); const pending = subject.run();
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
        const child = subject.children.at(-1); if (!child) throw new Error('child not started');
        child.emit('close', 0, null);
        assertResult(await pending, 'succeeded', '');
        assert.equal(reads, 0);
    } finally { delete (Object.prototype as { then?: unknown }).then; }
});

test('fails closed for launch, child, overflow, timeout, late output, and cleanup failures', async () => {
    const launch = harness({ spawnThrows: true });
    assertResult(await launch.run(), 'failed');
    assert.equal(launch.spawns.length, 0);
    const cases = [
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('error', new Error('synthetic')); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('close', 2, null); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.emit('close', null, 'SIGTERM'); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.stdout.emit('data', Buffer.alloc(32 * 1024 + 1)); assert.deepEqual(run.child.kills, ['SIGKILL']); run.child.emit('close', null, 'SIGKILL'); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { run.child.stderr.emit('data', Buffer.alloc(32 * 1024 + 1)); assert.deepEqual(run.child.kills, ['SIGKILL']); run.child.emit('close', null, 'SIGKILL'); },
        async (subject: ReturnType<typeof harness>, run: Awaited<ReturnType<ReturnType<typeof harness>['start']>>) => { subject.timeout()?.(); assert.deepEqual(run.child.kills, ['SIGKILL']); run.child.stdout.emit('data', Buffer.from('late')); run.child.emit('close', 0, null); },
    ];
    for (const close of cases) {
        const subject = harness(); const run = await subject.start(); await close(subject, run);
        assertResult(await run.pending, 'failed');
        assert.deepEqual(subject.removals, ['/tmp/ocr-test']);
    }
    const subject = harness({ cleanupFails: true }); const run = await subject.start();
    run.child.stdout.emit('data', Buffer.from('synthetic raw OCR')); run.child.emit('close', 0, null);
    assertResult(await run.pending, 'failed');
});
