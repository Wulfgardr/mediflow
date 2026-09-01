/* @Codex */

export type ClinicianSoapExplicitGestureDenialCode =
    | 'field_set_unavailable'
    | 'seal_unavailable'
    | 'seal_mismatch'
    | 'lifecycle_unavailable'
    | 'gesture_unavailable';

export type ClinicianSoapExplicitGestureResult =
    | Readonly<{ status: 'ready' }>
    | Readonly<{ status: 'pin_required' }>
    | Readonly<{ status: 'denied'; code: ClinicianSoapExplicitGestureDenialCode }>;

export type ClinicianSoapExplicitGestureOwner = Readonly<{
    prepare(fieldSet: unknown): Promise<ClinicianSoapExplicitGestureResult>;
    consumeExplicitGesture(): Promise<ClinicianSoapExplicitGestureResult>;
    close(): void;
}>;

type SealPort = (fieldSet: unknown) => unknown;
type ReopenPort = (bundle: unknown, expectedFieldSet: unknown) => unknown;
type BindGestureSealPort = (correlationToken: unknown, bundle: unknown) => unknown;
type CancelPresentationPort = (correlationToken: unknown) => unknown;
type State = 'idle' | 'preparing' | 'ready' | 'checking' | 'terminal';
type H4DenialCode = Exclude<ClinicianSoapExplicitGestureDenialCode, 'gesture_unavailable'>;
type ParsedSealResult =
    | Readonly<{ status: 'sealed'; bundle: unknown }>
    | Readonly<{ status: 'denied'; code: H4DenialCode }>;
type ParsedReopenResult =
    | Readonly<{ status: 'reopened' }>
    | Readonly<{ status: 'denied'; code: H4DenialCode }>;

const H4_DENIAL_CODES = new Set<H4DenialCode>([
    'field_set_unavailable',
    'seal_unavailable',
    'seal_mismatch',
    'lifecycle_unavailable',
]);

function record<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value));
}

const READY = record({ status: 'ready' as const });
const PIN_REQUIRED = record({ status: 'pin_required' as const });

function deny(code: ClinicianSoapExplicitGestureDenialCode): ClinicianSoapExplicitGestureResult {
    return record({ status: 'denied' as const, code });
}

function exactOwnData(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | null {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
    try {
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
            return null;
        }
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch {
        return null;
    }
}

function ownPort(value: unknown, key: 'seal'): SealPort | null;
function ownPort(value: unknown, key: 'reopen'): ReopenPort | null;
function ownPort(value: unknown, key: 'bindGestureSeal'): BindGestureSealPort | null;
function ownPort(value: unknown, key: 'cancelPresentation'): CancelPresentationPort | null;
function ownPort(value: unknown, key: 'seal' | 'reopen' | 'bindGestureSeal' | 'cancelPresentation'):
    SealPort | ReopenPort | BindGestureSealPort | CancelPresentationPort | null {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && 'value' in descriptor && typeof descriptor.value === 'function'
            ? descriptor.value as SealPort | ReopenPort | BindGestureSealPort | CancelPresentationPort
            : null;
    } catch {
        return null;
    }
}

function ownCorrelationToken(value: unknown): unknown | null {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'correlationToken');
        return descriptor && descriptor.enumerable && 'value' in descriptor ? descriptor.value : null;
    } catch {
        return null;
    }
}

function h4Denial(value: unknown): H4DenialCode | null {
    return typeof value === 'string' && H4_DENIAL_CODES.has(value as H4DenialCode)
        ? value as H4DenialCode
        : null;
}

function parseSealResult(value: unknown): ParsedSealResult | null {
    const sealed = exactOwnData(value, ['status', 'bundle']);
    if (sealed?.status === 'sealed') return { status: 'sealed', bundle: sealed.bundle };
    const denied = exactOwnData(value, ['status', 'code']);
    const code = denied?.status === 'denied' ? h4Denial(denied.code) : null;
    return code ? { status: 'denied', code } : null;
}

function parseReopenResult(value: unknown): ParsedReopenResult | null {
    const reopened = exactOwnData(value, ['status', 'fieldSet']);
    if (reopened?.status === 'reopened') return { status: 'reopened' };
    const denied = exactOwnData(value, ['status', 'code']);
    const code = denied?.status === 'denied' ? h4Denial(denied.code) : null;
    return code ? { status: 'denied', code } : null;
}

/** Defers the irreversible H4 seal past a replayable React effect setup. */
export function scheduleClinicianSoapExplicitGesturePreparation(operation: () => void): () => void {
    let active = true;
    queueMicrotask(() => {
        if (active) operation();
    });
    return () => { active = false; };
}

/** Owns the single H5a gesture between the H4 seal and the fresh-PIN boundary. */
export function createClinicianSoapExplicitGestureOwner(ports: unknown): ClinicianSoapExplicitGestureOwner {
    const seal = ownPort(ports, 'seal');
    const reopen = ownPort(ports, 'reopen');
    const bindGestureSeal = ownPort(ports, 'bindGestureSeal');
    const cancelPresentation = ownPort(ports, 'cancelPresentation');
    const correlationToken = ownCorrelationToken(ports);
    let state: State = 'idle';
    let retainedFieldSet: unknown;
    let retainedBundle: unknown;
    let cancellationRequested = false;
    let pinRequiredPublished = false;

    const terminalize = () => {
        const shouldCancel = state !== 'terminal' && !pinRequiredPublished && !cancellationRequested
            && cancelPresentation !== null && correlationToken !== null;
        retainedFieldSet = undefined;
        retainedBundle = undefined;
        state = 'terminal';
        if (shouldCancel) {
            cancellationRequested = true;
            try {
                const pending = cancelPresentation(correlationToken);
                if (pending instanceof Promise) void pending.catch(() => undefined);
            } catch { /* local terminalization already won */ }
        }
    };
    const unavailable = (): ClinicianSoapExplicitGestureResult => {
        terminalize();
        return deny('gesture_unavailable');
    };

    const prepare = async (fieldSet: unknown): Promise<ClinicianSoapExplicitGestureResult> => {
        if (state !== 'idle' || !seal || !reopen || !bindGestureSeal || !cancelPresentation
            || correlationToken === null) return unavailable();
        state = 'preparing';
        try {
            const result = parseSealResult(await seal(fieldSet));
            if (state !== 'preparing') {
                terminalize();
                return deny('gesture_unavailable');
            }
            if (!result) {
                terminalize();
                return deny('gesture_unavailable');
            }
            if (result.status === 'denied') {
                terminalize();
                return deny(result.code);
            }
            retainedFieldSet = fieldSet;
            retainedBundle = result.bundle;
            state = 'ready';
            return READY;
        } catch {
            terminalize();
            return deny('gesture_unavailable');
        }
    };

    const consumeExplicitGesture = async (): Promise<ClinicianSoapExplicitGestureResult> => {
        if (state !== 'ready' || !reopen || !bindGestureSeal || !cancelPresentation
            || correlationToken === null) return unavailable();
        state = 'checking';
        try {
            const bundle = retainedBundle;
            const pending = reopen(bundle, retainedFieldSet);
            retainedBundle = undefined;
            retainedFieldSet = undefined;
            const result = parseReopenResult(await pending);
            if (state !== 'checking') {
                terminalize();
                return deny('gesture_unavailable');
            }
            if (!result) {
                terminalize();
                return deny('gesture_unavailable');
            }
            if (result.status === 'denied') {
                terminalize();
                return deny(result.code);
            }
            const bound = await bindGestureSeal(correlationToken, bundle);
            if (state !== 'checking') {
                terminalize();
                return deny('gesture_unavailable');
            }
            if (bound !== true) {
                terminalize();
                return deny('gesture_unavailable');
            }
            pinRequiredPublished = true;
            terminalize();
            return PIN_REQUIRED;
        } catch {
            terminalize();
            return deny('gesture_unavailable');
        }
    };

    const close = () => { terminalize(); };
    return record({ prepare, consumeExplicitGesture, close });
}
