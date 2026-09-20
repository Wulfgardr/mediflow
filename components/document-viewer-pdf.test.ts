/* @Codex — explicit synthetic engine seam; NOT a real PDF/browser rendering test. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintPdfPage, type PreviewPdfEngineFactory, type PreviewPdfPage, type PreviewPdfDocument, type PreviewRenderTask } from './document-viewer-pdf-core.ts';
import { PREVIEW_LIMITS, PreviewError, previewCanvasSize } from './document-viewer-policy.ts';
import { boundedCanvasFactory, checkPdfOperators } from './document-viewer-pdf-resources.ts';
import { PreviewScope } from './document-viewer-scope.ts';
import { adaptPdfRenderTask } from './document-viewer-pdf.ts';

function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const fails = (code: string) => (error: unknown) => error instanceof PreviewError && error.code === code;
const ops = { image: 85, inline: 86, mask: 83, repeat: 88 };
const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
const canvas = () => ({ width: 12, height: 10, getContext: () => ({}) }) as unknown as HTMLCanvasElement;
function fixture() {
    const calls = { create: 0, dispose: 0, cleanup: 0, paint: 0, cancel: 0, pages: [] as number[] };
    const painted = deferred<unknown>();
    const task: PreviewRenderTask = { promise: painted.promise, cancel: () => { calls.cancel++; }, setContinuation: () => undefined };
    const page: PreviewPdfPage = {
        measure: () => ({ width: 600, height: 800 }),
        operators: async () => ({ fnArray: [], argsArray: [] }),
        paint: () => { calls.paint++; return task; },
        cleanup: () => { calls.cleanup++; },
    };
    const document: PreviewPdfDocument = {
        pages: 3,
        info: async () => ({ encrypted: false, xfa: false }),
        page: async (number) => { calls.pages.push(number); return page; },
    };
    const opened = deferred<PreviewPdfDocument>();
    let fail!: (error: PreviewError) => void;
    const factory: PreviewPdfEngineFactory = (_bytes, callback) => {
        calls.create++; fail = callback;
        return { document: opened.promise, imageOps: ops, dispose: () => { calls.dispose++; } };
    };
    return { calls, painted, task, page, document, opened, factory, fail: (error: PreviewError) => fail(error) };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('only requested page is opened; engine and scratch lifetime end even on success', async () => {
    const f = fixture(), target = canvas();
    f.opened.resolve(f.document); f.painted.resolve(undefined);
    const result = await paintPdfPage(bytes, 2, target, new AbortController().signal, f.factory);
    assert.deepEqual(f.calls.pages, [2]); assert.equal(f.calls.dispose, 1); assert.equal(f.calls.cleanup, 1);
    assert.deepEqual(result, { page: 2, pages: 3, width: 900, height: 1200 });
    assert.equal(target.width, 900); assert.equal(bytes[0], 37);
});
test('pre-aborted input never creates a worker/session', async () => {
    const f = fixture(), target = canvas(), controller = new AbortController(); controller.abort();
    await assert.rejects(paintPdfPage(bytes, 1, target, controller.signal, f.factory), fails('cancelled'));
    assert.equal(f.calls.create, 0); assert.equal(target.width, 0);
});
test('abort during open; late document cannot request or publish a page', async () => {
    const f = fixture(), target = canvas(), controller = new AbortController();
    const work = paintPdfPage(bytes, 1, target, controller.signal, f.factory);
    controller.abort();
    await assert.rejects(work, fails('cancelled'));
    f.opened.resolve(f.document); await tick();
    assert.equal(f.calls.dispose, 1); assert.equal(f.calls.paint, 0); assert.deepEqual(f.calls.pages, []);
    assert.equal(target.width, 0);
});
test('abort during getPage cleans a late page instead of rendering it', async () => {
    const f = fixture(), target = canvas(), controller = new AbortController(), late = deferred<PreviewPdfPage>();
    f.document.page = () => late.promise; f.opened.resolve(f.document);
    const work = paintPdfPage(bytes, 1, target, controller.signal, f.factory);
    await tick(); controller.abort();
    await assert.rejects(work, fails('cancelled'));
    late.resolve(f.page); await tick();
    assert.equal(f.calls.cleanup, 1); assert.equal(f.calls.paint, 0); assert.equal(f.calls.dispose, 1);
});
test('abort during rasterization cancels render and clears canvas, late completion stays invisible', async () => {
    const f = fixture(), target = canvas(), controller = new AbortController(); f.opened.resolve(f.document);
    const work = paintPdfPage(bytes, 1, target, controller.signal, f.factory);
    await tick(); assert.equal(f.calls.paint, 1);
    controller.abort(); await assert.rejects(work, fails('cancelled'));
    f.painted.resolve(undefined); await tick();
    assert.equal(f.calls.cancel, 1); assert.equal(f.calls.dispose, 1); assert.equal(target.width, 0); assert.equal(target.height, 0);
});
test('timeout is distinct from cancellation and terminates an unresolved open', async () => {
    const f = fixture(), target = canvas();
    await assert.rejects(paintPdfPage(bytes, 1, target, new AbortController().signal, f.factory, 10), fails('timeout'));
    assert.equal(f.calls.dispose, 1); assert.equal(target.width, 0);
    f.opened.reject(new Error('late synthetic error')); await tick();
});
test('password callback settles immediately without awaiting password or worker acknowledgement', async () => {
    const f = fixture(), target = canvas();
    const work = paintPdfPage(bytes, 1, target, new AbortController().signal, f.factory);
    f.fail(new PreviewError('encrypted_pdf'));
    await assert.rejects(work, fails('encrypted_pdf'));
    assert.equal(f.calls.dispose, 1); assert.equal(f.calls.paint, 0);
});
test('synchronous factory failure callback cannot orphan the returned engine', async () => {
    let disposed = 0;
    const factory: PreviewPdfEngineFactory = (_source, fail) => {
        fail(new PreviewError('runtime_unavailable'));
        return { document: new Promise(() => undefined), imageOps: ops, dispose: () => { disposed++; } };
    };
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, factory), fails('runtime_unavailable'));
    assert.equal(disposed, 1);
});
for (const [info, code] of [[{ encrypted: true, xfa: false }, 'encrypted_pdf'], [{ encrypted: false, xfa: true }, 'xfa_pdf']] as const) {
    test(`metadata rejects ${code} before any page, including empty-password encryption`, async () => {
        const f = fixture(); f.document.info = async () => info; f.opened.resolve(f.document);
        await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, f.factory), fails(code));
        assert.equal(f.calls.dispose, 1); assert.deepEqual(f.calls.pages, []);
    });
}
test('page-count and viewport limits fail before rendering; raw errors are not exposed', async () => {
    const f = fixture(); f.document.pages = 501; f.opened.resolve(f.document);
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, f.factory), fails('page_limit'));
    const g = fixture(); g.opened.resolve(g.document); g.page.measure = () => ({ width: 15000, height: 1 });
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, g.factory), fails('page_dimensions'));
    assert.equal(g.calls.paint, 0);
    const h = fixture(); h.opened.reject(new Error('SYNTHETIC_PRIVATE_TEXT'));
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, h.factory), fails('invalid_pdf'));
});
test('complex operators are rejected before paint', async () => {
    const f = fixture(); f.opened.resolve(f.document);
    f.page.operators = async () => ({ fnArray: Array(PREVIEW_LIMITS.operators + 1).fill(1), argsArray: Array(PREVIEW_LIMITS.operators + 1).fill([]) });
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, f.factory), fails('operation_limit'));
    assert.equal(f.calls.paint, 0); assert.equal(f.calls.dispose, 1);
});
test('auxiliary resource failure is typed and terminal even while render is pending', async () => {
    const f = fixture(), target = canvas(); f.opened.resolve(f.document);
    const work = paintPdfPage(bytes, 1, target, new AbortController().signal, f.factory);
    await tick(); f.fail(new PreviewError('missing_resource'));
    await assert.rejects(work, fails('missing_resource'));
    assert.equal(f.calls.dispose, 1); assert.equal(target.width, 0);
});
test('viewport/pixel bounds, including tiny/fractional/invalid dimensions', () => {
    for (const dimensions of [[600, 800], [14400, 14400], [0.001, 1], [10, 12000]]) {
        const size = previewCanvasSize(dimensions[0], dimensions[1], true);
        assert.ok(size.width >= 1 && size.height >= 1);
        assert.ok(size.width <= 2048 && size.height <= 2048 && size.width * size.height <= 4_000_000);
    }
    for (const n of [0, -1, NaN, Infinity, 14401]) assert.throws(() => previewCanvasSize(n, 10, true), fails('page_dimensions'));
});
test('operand depth, decoded-image pixels and data bytes are bounded after materialization', () => {
    assert.throws(() => checkPdfOperators({ fnArray: [ops.image], argsArray: [['id', 10000, 2]] }, ops), fails('image_limit'));
    let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = [deep];
    assert.throws(() => checkPdfOperators({ fnArray: [1], argsArray: [[deep]] }, ops), fails('operation_limit'));
    assert.throws(() => checkPdfOperators({ fnArray: [1], argsArray: [[new Uint8Array(PREVIEW_LIMITS.operandBytes + 1)]] }, ops), fails('memory_limit'));
});
test('scratch canvas live count, allocation/reset budget and idempotent cleanup', () => {
    const factory = boundedCanvasFactory(canvas), allocator = new factory.CanvasFactory();
    const first = allocator.create(3000, 3000);
    assert.throws(() => allocator.create(2000, 2000), fails('memory_limit'));
    allocator.reset(first, 100, 100);
    const second = allocator.create(2000, 2000);
    allocator.destroy(first); assert.equal(first.canvas, null);
    const actual = second.canvas;
    factory.dispose(); factory.dispose(); assert.equal(actual.width, 0);
    const tiny = Array.from({ length: PREVIEW_LIMITS.scratchCanvases }, () => allocator.create(1, 1));
    assert.throws(() => allocator.create(1, 1), fails('memory_limit'));
    for (const item of tiny) allocator.destroy(item);
});
test('nested deadline reason preserved; late resource release and rejection draining', async () => {
    const parent = new AbortController(), scope = new PreviewScope(parent.signal, 1000), late = deferred<{ release: boolean }>();
    let releases = 0;
    const wait = scope.wait(late.promise, () => { releases++; });
    parent.abort(new PreviewError('timeout'));
    await assert.rejects(wait, fails('timeout'));
    late.resolve({ release: true }); await tick();
    assert.equal(releases, 1); scope.finish();
});

// Null operands are legitimate for PDF.js argument-free operators.
test('PDF operators accept null operands, but image operands remain mandatory', () => {
    const codes = { image: 85, inline: 86, mask: 83, repeat: 88 };
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [10, 31, 32, 11], argsArray: [null, null, null, null] }, codes));
    assert.throws(() => checkPdfOperators({ fnArray: [85], argsArray: [null] }, codes), { code: 'invalid_pdf' });
});


test('typed PDF.js adapter forwards promise identity, cancel receiver and continuation', async () => {
    let resumed = 0, cancelled = 0;
    const raw = {
        promise: Promise.resolve(),
        onContinue: (_next: () => void) => { throw new Error('callback not installed'); },
        cancel() { assert.equal(this, raw); cancelled++; },
    };
    const port = adaptPdfRenderTask(raw);
    assert.equal(port.promise, raw.promise);
    port.setContinuation((next) => { next(); });
    raw.onContinue(() => { resumed++; });
    port.cancel();
    assert.equal(resumed, 1); assert.equal(cancelled, 1);
    await port.promise;
});
test('typed PDF.js adapter preserves rejection rather than swallowing render failure', async () => {
    const raw = {
        promise: Promise.reject(new Error('synthetic render rejection')),
        cancel() {}, onContinue: (_next: () => void) => undefined,
    };
    const port = adaptPdfRenderTask(raw);
    await assert.rejects(port.promise, { message: 'synthetic render rejection' });
});
test('a queued continuation cannot resume after cancellation', async () => {
    const f = fixture(), target = canvas(), controller = new AbortController();
    let continuation: ((next: () => void) => void) | undefined, resumed = 0;
    f.task.setContinuation = (callback) => { continuation = callback; };
    f.opened.resolve(f.document);
    const work = paintPdfPage(bytes, 1, target, controller.signal, f.factory);
    await tick(); assert.ok(continuation);
    continuation(() => { resumed++; });
    controller.abort();
    await assert.rejects(work, fails('cancelled'));
    await tick();
    assert.equal(resumed, 0); assert.equal(f.calls.dispose, 1); assert.equal(target.width, 0);
});

// Follow-up 2: these shapes are checked again with the supplied authentic
// PDF.js 4.10.38 parser in tests/pdfjs-operator-regression.mjs. No renderer mock
// or readiness marker is involved in that separate parser regression.
for (const code of [58, 59]) {
    test(`PDF.js RGB opcode ${code} accepts exactly three clamped/array byte channels without mutation`, () => {
        for (const args of [new Uint8ClampedArray([217, 20, 38]), [0, 128, 255]]) {
            const before = Array.from(args);
            const list = { fnArray: [code], argsArray: [args] };
            assert.doesNotThrow(() => checkPdfOperators(list, ops));
            assert.equal(list.argsArray[0], args); assert.deepEqual(Array.from(args), before);
        }
    });
    test(`PDF.js RGB opcode ${code} rejects wrong arity, type, range and non-finite channels`, () => {
        const alternatives: unknown[] = [null, undefined, [], [1, 2], [1, 2, 3, 4], [1, 2, NaN],
            [1, 2, Infinity], [1, 2, -1], [256, 0, 0], [0.5, 1, 2], ['1', 2, 3], [true, 2, 3],
            new Uint8ClampedArray(2), new Uint8ClampedArray(4), new Uint8Array([1, 2, 3]),
            new Float32Array([1, 2, 3]), new Float64Array([1, 2, 3]), new Int32Array([1, 2, 3]),
            new DataView(new ArrayBuffer(3)), new ArrayBuffer(3), { 0: 1, 1: 2, 2: 3, length: 3 }];
        for (const args of alternatives) assert.throws(() => checkPdfOperators({ fnArray: [code], argsArray: [args] }, ops), fails('invalid_pdf'));
    });
}
test('RGB exception is opcode-specific; unknown opcodes and other outer views remain denied', () => {
    for (const code of [1, 10, 12, 44, 83, 85, 86, 88, 91]) {
        assert.throws(() => checkPdfOperators({ fnArray: [code], argsArray: [new Uint8ClampedArray([1, 2, 3])] }, ops), fails('invalid_pdf'));
    }
    for (const code of [-1, 0, 78, 79, 82, 94, 999, 1.5, NaN, Infinity]) {
        assert.throws(() => checkPdfOperators({ fnArray: [code], argsArray: [[]] }, ops), fails('invalid_pdf'));
    }
    assert.throws(() => checkPdfOperators({ fnArray: [59], argsArray: [] }, ops), fails('invalid_pdf'));
});
test('omitted operands are only allowed on argument-free PDF.js operators', () => {
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [10, 43, 11], argsArray: [undefined, undefined, undefined] }, ops));
    for (const code of [1, 12, 37, 44, 58, 59, 83, 85, 86, 88, 91]) {
        assert.throws(() => checkPdfOperators({ fnArray: [code], argsArray: [undefined] }, ops), fails('invalid_pdf'));
    }
});
test('real structured-clone glyph, graphics state, image and vector IR types remain admissible', () => {
    const glyph = { originalCharCode: 65, fontChar: 'A', unicode: 'A', accent: null, width: 667,
        vmetric: undefined, operatorListId: undefined, isSpace: false, isInFont: true };
    const image = { width: 2, height: 2, kind: 3, data: new Uint8ClampedArray(16) };
    const list = structuredClone({ fnArray: [44, 9, 86, 88, 91], argsArray: [
        [[glyph, -120, glyph]], [[['D', [[2, 3], 0]], ['SMask', false]]], [image],
        ['img_1', 1, 1, new Float32Array([10, 20, 30, 40])],
        [[13, 14, 15, 18], [0, 0, 50, 50, 10, 20, 30, 40, 50, 60], [0, 0, 50, 50]],
    ] });
    assert.doesNotThrow(() => checkPdfOperators(list, ops));
});
test('nested typed numeric elements are finite and charged against the node budget', () => {
    for (const n of [NaN, Infinity, -Infinity]) {
        assert.throws(() => checkPdfOperators({ fnArray: [88], argsArray: [['img_1', 1, 1, new Float32Array([0, n])]] }, ops), fails('invalid_pdf'));
    }
    assert.throws(() => checkPdfOperators({ fnArray: [88], argsArray: [['img_1', 1, 1, new Float32Array(PREVIEW_LIMITS.operandNodes)]] }, ops), fails('operation_limit'));
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [53], argsArray: [[new Int32Array([1, 2, 3])]] }, ops));
});
test('unsupported nested objects/views are invalid, not silently ignored', () => {
    const unknown: unknown[] = [new DataView(new ArrayBuffer(8)), new ArrayBuffer(8), new Float64Array(2),
        new Uint16Array(2), new BigInt64Array(2), new Date(0), new Map(), new Set(), () => undefined, Symbol('synthetic'), BigInt(1)];
    for (const value of unknown) assert.throws(() => checkPdfOperators({ fnArray: [44], argsArray: [[[value]]] }, ops), fails('invalid_pdf'));
    const cycle: unknown[] = []; cycle.push(cycle);
    assert.throws(() => checkPdfOperators({ fnArray: [44], argsArray: [cycle] }, ops), fails('invalid_pdf'));
    let invoked = false;
    const accessor = { get width() { invoked = true; return 1; } };
    assert.throws(() => checkPdfOperators({ fnArray: [44], argsArray: [[accessor]] }, ops), fails('invalid_pdf'));
    assert.equal(invoked, false);
});
test('typed backing allocation cannot hide behind a tiny RGB subview or shared buffer', () => {
    const large = new ArrayBuffer(PREVIEW_LIMITS.operandBytes + 1);
    const rgb = new Uint8ClampedArray(large, 0, 3);
    assert.throws(() => checkPdfOperators({ fnArray: [59], argsArray: [rgb] }, ops), fails('memory_limit'));
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(3));
    assert.throws(() => checkPdfOperators({ fnArray: [59], argsArray: [shared] }, ops), fails('invalid_pdf'));
});
test('operator count, byte cap and image budgets still apply to legitimate typed operands', () => {
    const count = PREVIEW_LIMITS.operators;
    const rgb = new Uint8ClampedArray([0, 0, 0]);
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: Array(count).fill(59), argsArray: Array(count).fill(rgb) }, ops));
    assert.throws(() => checkPdfOperators({ fnArray: Array(count + 1).fill(59), argsArray: Array(count + 1).fill(rgb) }, ops), fails('operation_limit'));
    const data = new Uint8Array(PREVIEW_LIMITS.operandBytes);
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [1], argsArray: [[data]] }, ops));
    assert.throws(() => checkPdfOperators({ fnArray: [1], argsArray: [[data, 'x']] }, ops), fails('memory_limit'));
    assert.throws(() => checkPdfOperators({ fnArray: [86], argsArray: [[{ width: 8193, height: 1, data: new Uint8Array(1) }]] }, ops), fails('image_limit'));
    assert.throws(() => checkPdfOperators({ fnArray: [85, 85, 85], argsArray: [
        ['img_1', 3000, 3000], ['img_2', 3000, 3000], ['img_3', 3000, 3000],
    ] }, ops), fails('memory_limit'));
});
test('constructPath permits only its exact empty-bounds metadata sentinel, never non-finite geometry', () => {
    const empty = [Infinity, Infinity, -Infinity, -Infinity];
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [91], argsArray: [[[18], [], empty]] }, ops));
    assert.doesNotThrow(() => checkPdfOperators({ fnArray: [91], argsArray: [[[15], [1, 2, 3, 4, 5, 6], empty]] }, ops));
    for (const args of [
        [[13], [0, 0], empty], [[18], [], [Infinity, 0, -Infinity, 0]], [[15], [1, 2, 3, 4, 5, NaN], empty],
        [[15], [1, 2], empty], [[999], [], empty], [[18], [], [0, 0, 0]], [[18], [], [0, 0, 0, '0']],
    ]) assert.throws(() => checkPdfOperators({ fnArray: [91], argsArray: [args] }, ops), fails('invalid_pdf'));
    assert.throws(() => checkPdfOperators({ fnArray: [44], argsArray: [[empty]] }, ops), fails('invalid_pdf'));
});
test('valid typed RGB reaches paint and retains disposal; invalid typed RGB never paints', async () => {
    const good = fixture(); good.opened.resolve(good.document); good.painted.resolve(undefined);
    good.page.operators = async () => ({ fnArray: [59], argsArray: [new Uint8ClampedArray([217, 20, 38])] });
    await paintPdfPage(bytes, 1, canvas(), new AbortController().signal, good.factory);
    assert.equal(good.calls.paint, 1); assert.equal(good.calls.dispose, 1); assert.equal(good.calls.cleanup, 1);
    const bad = fixture(); bad.opened.resolve(bad.document);
    bad.page.operators = async () => ({ fnArray: [59], argsArray: [new Float32Array([217, 20, 38])] });
    await assert.rejects(paintPdfPage(bytes, 1, canvas(), new AbortController().signal, bad.factory), fails('invalid_pdf'));
    assert.equal(bad.calls.paint, 0); assert.equal(bad.calls.dispose, 1);
});
