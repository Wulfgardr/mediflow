import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type AmbienteOperatore = Readonly<{
    origin: string;
    richiestaPrefisso: string;
    richieste(): number;
}>;

class MemoriaStorage {
    protected valori = new Map<string, string>();
    get length() { return this.valori.size; }
    key(index: number) { return [...this.valori.keys()][index] ?? null; }
    getItem(key: string) { return this.valori.get(key) ?? null; }
    setItem(key: string, value: string) { this.valori.set(key, String(value)); this.salva(); }
    removeItem(key: string) { this.valori.delete(key); this.salva(); }
    clear() { this.valori.clear(); this.salva(); }
    protected salva() {}
}

class FileStorage extends MemoriaStorage {
    constructor(private readonly file: string) {
        super();
        try {
            const letto = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
            for (const [key, value] of Object.entries(letto)) if (typeof value === 'string') this.valori.set(key, value);
        } catch { this.valori.clear(); }
    }
    protected salva() {
        mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const temporaneo = `${this.file}.${process.pid}.tmp`;
        writeFileSync(temporaneo, JSON.stringify(Object.fromEntries(this.valori)), { mode: 0o600 });
        chmodSync(temporaneo, 0o600);
        renameSync(temporaneo, this.file);
    }
}

function storageProxy(storage: MemoriaStorage): Storage {
    return new Proxy(storage, {
        ownKeys: target => [...Array.from({ length: target.length }, (_, index) => target.key(index)!)],
        getOwnPropertyDescriptor: (target, key) => typeof key === 'string' && target.getItem(key) !== null
            ? { value: target.getItem(key), enumerable: true, configurable: true } : undefined,
    }) as unknown as Storage;
}

const COOKIE = /^([A-Za-z0-9_-]+)=([^;]*)/u;

/**
 * Installa in Node le sole API del browser che il client Web di MediFlow usa: finestra con
 * eventi, `location` sull'origine loopback, storage e `fetch` same-origin con i cookie della
 * sessione. Ogni richiesta porta `x-request-id` con il prefisso dell'operatore, che l'audit registra.
 */
export function installaAmbienteOperatore(options: { origin: string; storageFile: string | null }): AmbienteOperatore {
    const origin = new URL(options.origin).origin;
    const host = new URL(origin).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('L’operatore lavora solo sul loopback.');
    const bersaglio = new EventTarget();
    const cookies = new Map<string, { value: string; httpOnly: boolean }>();
    const prefisso = `mfop-${randomUUID().slice(0, 8)}`;
    let contatore = 0;
    const nativo = globalThis.fetch.bind(globalThis);

    const fetchOperatore: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), origin);
        if (url.origin !== origin) throw new Error('L’operatore non chiama indirizzi fuori da MediFlow.');
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (cookies.size) headers.set('cookie', [...cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; '));
        headers.set('sec-fetch-site', 'same-origin');
        if (method !== 'GET' && method !== 'HEAD') headers.set('origin', origin);
        headers.set('x-request-id', `${prefisso}-${++contatore}`);
        const body = init?.body ?? (input instanceof Request ? await input.arrayBuffer() : undefined);
        const response = await nativo(url, { ...init, method, headers, ...(body !== undefined ? { body } : {}), redirect: 'manual' });
        for (const campo of response.headers.getSetCookie()) {
            const match = COOKIE.exec(campo);
            if (!match) continue;
            if (/;\s*max-age=0/iu.test(campo) || /;\s*expires=Thu, 01 Jan 1970/iu.test(campo) || match[2] === '') cookies.delete(match[1]);
            else cookies.set(match[1], { value: match[2], httpOnly: /;\s*httponly/iu.test(campo) });
        }
        return response;
    };

    const location = Object.assign(new URL(`${origin}/`), {
        reload() { throw new Error('ARCHIVE_REPLACED'); },
        assign() {}, replace() {},
    });
    const memoria = storageProxy(new MemoriaStorage());
    const persistente = storageProxy(options.storageFile ? new FileStorage(options.storageFile) : new MemoriaStorage());
    Object.assign(globalThis, {
        window: globalThis,
        self: globalThis,
        location,
        fetch: fetchOperatore,
        sessionStorage: memoria,
        localStorage: persistente,
        addEventListener: bersaglio.addEventListener.bind(bersaglio),
        removeEventListener: bersaglio.removeEventListener.bind(bersaglio),
        dispatchEvent: bersaglio.dispatchEvent.bind(bersaglio),
        document: {
            visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {},
            get cookie() { return [...cookies].filter(([, cookie]) => !cookie.httpOnly).map(([name, cookie]) => `${name}=${cookie.value}`).join('; '); },
        },
    });
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'MediFlow-Operatore', onLine: true }, configurable: true });
    return { origin, richiestaPrefisso: prefisso, richieste: () => contatore };
}
