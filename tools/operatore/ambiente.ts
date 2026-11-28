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

const AUTH_CONSENTITE = new Set(['/api/auth/login', '/api/auth/logout']);
const SISTEMA_VIETATE = ['backup-restore', 'restore-patient', 'purge-patient', 'migrate', 'migrate-m2m', 'repair-db', 'fix-orphans', 'retention']
    .map(nome => `/api/system/${nome}`);

export class GestoRiservatoAlMedico extends Error {
    constructor(readonly gesto: string) { super(`L’operatore non può ${gesto}: è un gesto del medico nell’interfaccia.`); }
}

/** Gesti che restano al medico anche con l’operatore acceso (ADR 0206): il client li rifiuta prima di chiamare il server. */
export function gestoRiservato(method: string, pathname: string): string | null {
    const lettura = method === 'GET' || method === 'HEAD';
    const sotto = (prefisso: string) => pathname === prefisso || pathname.startsWith(`${prefisso}/`);
    if (sotto('/api/agent')) return 'usare il canale degli agenti';
    if (sotto('/api/agent-mandates') && !lettura && pathname !== '/api/agent-mandates/unlock') return 'collegare, scollegare o modificare gli agenti';
    if (sotto('/api/auth') && !lettura && !AUTH_CONSENTITE.has(pathname)) return 'cambiare credenziali, bloccare o ricollegare le schede';
    if (SISTEMA_VIETATE.some(sotto) && !lettura) return 'ripristinare, migrare, riparare o cancellare l’archivio';
    if (method === 'DELETE') return 'cancellare';
    return null;
}

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
        const riservato = gestoRiservato(method, url.pathname);
        if (riservato) throw new GestoRiservatoAlMedico(riservato);
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
