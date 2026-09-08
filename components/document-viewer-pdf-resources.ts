/* @Codex — application-level allocation/complexity budgets, not a PDF parser heap quota. */
import { assertImageSize, clearPreviewCanvas, PREVIEW_LIMITS, PreviewError } from './document-viewer-policy.ts';

export type PreviewOperatorList = { fnArray: number[]; argsArray: unknown[] };
export type PreviewImageOps = { image: number; inline: number; mask: number; repeat: number };

// Pinned PDF.js 4.10.38 shared/util.js OPS and core/evaluator.js protocol.
// Keep the guard dependency-free; the adapter supplies image opcodes and the
// delivery parser regression checks these representations against the real build.
const STROKE_RGB = 58, FILL_RGB = 59, CONSTRUCT_PATH = 91;
const argumentFree = new Set([
    10, 11, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 43,
    71, 72, 73, 75, 77, 81, 90, 92, 93,
]);
const knownOperator = (op: number) => Number.isInteger(op) && op >= 1 && op <= 93
    && op !== 78 && op !== 79 && op !== 82;

// buildPath emits Array operands, including this exact empty min/max sentinel
// when a chunk starts with a curve/closePath. It is metadata, not coordinates.
// No other non-finite number is admitted, even elsewhere in the same path.
function checkPath(args: unknown[]): boolean {
    if (args.length !== 3 || !args.every(Array.isArray)) throw new PreviewError('invalid_pdf');
    const [ops, coordinates, bounds] = args;
    if (ops.length > PREVIEW_LIMITS.operandNodes || coordinates.length > PREVIEW_LIMITS.operandNodes) {
        throw new PreviewError('operation_limit');
    }
    if (ops.length === 0 || bounds.length !== 4) throw new PreviewError('invalid_pdf');
    let count = 0, hasBounds = false;
    for (const op of ops) {
        switch (op) {
            case 13: case 14: count += 2; hasBounds = true; break; // moveTo/lineTo
            case 15: count += 6; break; // curveTo
            case 16: case 17: count += 4; break; // curveTo2/curveTo3
            case 18: break; // closePath
            case 19: count += 4; hasBounds = true; break; // rectangle
            default: throw new PreviewError('invalid_pdf');
        }
    }
    if (coordinates.length !== count) throw new PreviewError('invalid_pdf');
    const emptyBounds = !hasBounds && bounds[0] === Infinity && bounds[1] === Infinity
        && bounds[2] === -Infinity && bounds[3] === -Infinity;
    if (!coordinates.every((value) => typeof value === 'number' && Number.isFinite(value))
        || (!emptyBounds && !bounds.every((value) => typeof value === 'number' && Number.isFinite(value)))) {
        throw new PreviewError('invalid_pdf');
    }
    return emptyBounds;
}

export function checkPdfOperators(list: PreviewOperatorList, codes: PreviewImageOps): void {
    if (!Array.isArray(list.fnArray) || !Array.isArray(list.argsArray) || list.fnArray.length !== list.argsArray.length) {
        throw new PreviewError('invalid_pdf');
    }
    if (list.fnArray.length > PREVIEW_LIMITS.operators) throw new PreviewError('operation_limit');
    let nodes = 0, bytes = 0, imagePixels = 0;
    const seen = new WeakSet<object>(), active = new WeakSet<object>(), buffers = new WeakSet<ArrayBuffer>();
    const visit = (depth: number, count = 1) => {
        nodes += count;
        if (nodes > PREVIEW_LIMITS.operandNodes || depth > PREVIEW_LIMITS.operandDepth) throw new PreviewError('operation_limit');
    };
    const addBytes = (size: number) => {
        bytes += size;
        if (bytes > PREVIEW_LIMITS.operandBytes) throw new PreviewError('memory_limit');
    };
    const image = (w: unknown, h: unknown) => {
        if (typeof w !== 'number' || typeof h !== 'number') throw new PreviewError('invalid_pdf');
        assertImageSize(w, h);
        imagePixels += w * h;
        if (imagePixels > PREVIEW_LIMITS.pageImagePixels) throw new PreviewError('memory_limit');
    };
    const walk = (value: unknown, depth: number): void => {
        visit(depth);
        if (typeof value === 'string') { addBytes(value.length * 2); return; }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new PreviewError('invalid_pdf');
            addBytes(8); return;
        }
        // Missing optional glyph fields are undefined after structured clone;
        // booleans/null also occur in graphics state, images and glyph records.
        if (value === null || value === undefined || typeof value === 'boolean') return;
        if (typeof value !== 'object') throw new PreviewError('invalid_pdf');
        if (active.has(value)) throw new PreviewError('invalid_pdf');
        if (seen.has(value)) return;
        seen.add(value);
        if (ArrayBuffer.isView(value)) {
            // Only number views emitted in the pinned image/color/vector IR.
            // DataView, BigInt arrays, raw/shared buffers and custom subclasses
            // are not generic escape hatches around recursive validation.
            const prototype = Object.getPrototypeOf(value);
            const binary = (value instanceof Uint8Array && prototype === Uint8Array.prototype)
                || (value instanceof Uint8ClampedArray && prototype === Uint8ClampedArray.prototype);
            const numeric = (value instanceof Float32Array && prototype === Float32Array.prototype)
                || (value instanceof Int32Array && prototype === Int32Array.prototype);
            if ((!binary && !numeric) || !(value.buffer instanceof ArrayBuffer)) throw new PreviewError('invalid_pdf');
            if (!buffers.has(value.buffer)) {
                buffers.add(value.buffer);
                // A short subview still retains its entire backing allocation.
                addBytes(value.buffer.byteLength);
            }
            if (numeric) {
                visit(depth + 1, value.length);
                for (const number of value) if (!Number.isFinite(number)) throw new PreviewError('invalid_pdf');
            }
            return;
        }
        active.add(value);
        try {
            if (Array.isArray(value)) {
                if (value.length > PREVIEW_LIMITS.operandNodes - nodes) throw new PreviewError('operation_limit');
                for (const item of value) walk(item, depth + 1);
            } else {
                const prototype = Object.getPrototypeOf(value);
                if (prototype !== Object.prototype && prototype !== null) throw new PreviewError('invalid_pdf');
                const keys = Reflect.ownKeys(value);
                if (keys.length > PREVIEW_LIMITS.operandNodes - nodes) throw new PreviewError('operation_limit');
                for (const key of keys) {
                    const field = Object.getOwnPropertyDescriptor(value, key);
                    if (typeof key !== 'string' || !field || !('value' in field)) throw new PreviewError('invalid_pdf');
                    addBytes(key.length * 2);
                    walk(field.value, depth + 1);
                }
                // Inline image/mask dimensions, including grouped images. No
                // accessor is invoked; only plain structured-clone records pass.
                const w = Object.getOwnPropertyDescriptor(value, 'width');
                const h = Object.getOwnPropertyDescriptor(value, 'height');
                const data = Object.getOwnPropertyDescriptor(value, 'data');
                if (w && h && data) image(w.value, h.value);
            }
        } finally { active.delete(value); }
    };
    for (let i = 0; i < list.fnArray.length; i++) {
        const op = list.fnArray[i], args = list.argsArray[i];
        if (!knownOperator(op)) throw new PreviewError('invalid_pdf');
        if (op === STROKE_RGB || op === FILL_RGB) {
            // ColorSpace.getRgb returns Uint8ClampedArray(3), NOT Array. Only
            // RGB opcodes admit this outer typed representation. Plain byte
            // triples remain compatible; neither floats nor other views do.
            if (!(Array.isArray(args) || (args instanceof Uint8ClampedArray
                && Object.getPrototypeOf(args) === Uint8ClampedArray.prototype)) || args.length !== 3) {
                throw new PreviewError('invalid_pdf');
            }
            for (const channel of args) {
                if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255) {
                    throw new PreviewError('invalid_pdf');
                }
            }
        } else if (args === null || args === undefined) {
            // addOp may omit args for save/restore/nextLine as well as use null.
            if (!argumentFree.has(op)) throw new PreviewError('invalid_pdf');
        } else if (!Array.isArray(args)) throw new PreviewError('invalid_pdf');
        if (op === codes.image) {
            if (!Array.isArray(args)) throw new PreviewError('invalid_pdf');
            image(args[1], args[2]);
        }
        if (op === CONSTRUCT_PATH) {
            if (!Array.isArray(args)) throw new PreviewError('invalid_pdf');
            const emptyBounds = checkPath(args);
            visit(0); walk(args[0], 1); walk(args[1], 1);
            if (emptyBounds) { visit(1); visit(2, 4); addBytes(4 * 8); }
            else walk(args[2], 1);
        } else walk(args, 0);
    }
}

type Surface = { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null };
export function boundedCanvasFactory(makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
    const live = new Map<HTMLCanvasElement, number>();
    let pixels = 0;
    const dimensions = (width: number, height: number, previous = 0) => {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new PreviewError('memory_limit');
        const w = Math.ceil(width), h = Math.ceil(height);
        if (w > PREVIEW_LIMITS.imageDimension || h > PREVIEW_LIMITS.imageDimension
            || pixels - previous + w * h > PREVIEW_LIMITS.scratchPixels) throw new PreviewError('memory_limit');
        return { width: w, height: h, pixels: w * h };
    };
    class CanvasFactory {
        create(width: number, height: number) {
            if (live.size >= PREVIEW_LIMITS.scratchCanvases) throw new PreviewError('memory_limit');
            const size = dimensions(width, height);
            const canvas = makeCanvas();
            canvas.width = size.width; canvas.height = size.height;
            const context = canvas.getContext('2d');
            if (!context) { clearPreviewCanvas(canvas); throw new PreviewError('runtime_unavailable'); }
            live.set(canvas, size.pixels); pixels += size.pixels;
            return { canvas, context };
        }
        reset(target: Surface, width: number, height: number) {
            const canvas = target.canvas;
            if (!canvas || !live.has(canvas)) throw new PreviewError('memory_limit');
            const previous = live.get(canvas)!;
            const size = dimensions(width, height, previous);
            canvas.width = size.width; canvas.height = size.height;
            live.set(canvas, size.pixels); pixels += size.pixels - previous;
        }
        destroy(target: Surface) {
            if (target.canvas) {
                pixels -= live.get(target.canvas) ?? 0;
                live.delete(target.canvas);
                clearPreviewCanvas(target.canvas);
            }
            target.canvas = null; target.context = null;
        }
    }
    return {
        CanvasFactory,
        dispose() {
            for (const canvas of live.keys()) clearPreviewCanvas(canvas);
            live.clear(); pixels = 0;
        },
    };
}
