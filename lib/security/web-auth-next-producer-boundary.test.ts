/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPECTED_NODE = process.versions.node;
const EXPECTED_NODE_MAJOR = 24;
const EXPECTED_NODE_ABI = '137';
const EXPECTED_NEXT = '16.3.4';
const SESSION_ID = 'a'.repeat(64);
const CONTROL_ID = 'c'.repeat(64);

type ProducerEvidence = {
    node: string;
    abi: string;
    next: string;
    promise: { native: boolean; proxy: boolean; sameRealm: boolean };
    cookies: Array<{
        name: string;
        value: string;
        path: string;
        proxy: boolean;
        prototype: string;
        keys: string[];
        descriptors: Record<string, PropertyDescriptor>;
    }>;
};

const ROUTE = String.raw`
import { types } from 'node:util';
import nextPackage from 'next/package.json';
import { cookies } from 'next/headers';

const describeCookie = (cookie) => ({
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    proxy: types.isProxy(cookie),
    prototype: Object.getPrototypeOf(cookie) === Object.prototype ? 'Object.prototype' : 'other',
    keys: Reflect.ownKeys(cookie).map(String),
    descriptors: Object.fromEntries(Reflect.ownKeys(cookie).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(cookie, key);
        return [String(key), {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            writable: 'writable' in descriptor ? descriptor.writable : null,
            kind: 'value' in descriptor ? 'data' : 'accessor',
        }];
    })),
});

export async function GET() {
    const cookiePromise = cookies();
    const promise = {
        native: types.isPromise(cookiePromise),
        proxy: types.isProxy(cookiePromise),
        sameRealm: Object.getPrototypeOf(cookiePromise) === Promise.prototype,
    };
    const store = await cookiePromise;
    return Response.json({
        node: process.versions.node,
        abi: process.versions.modules,
        next: nextPackage.version,
        promise,
        cookies: [store.get('mediflow_session'), store.get('mediflow_auth_control')].map(describeCookie),
    });
}
`;

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return address.port;
}

async function bounded<Value>(promise: Promise<Value>, milliseconds: number, label: string): Promise<Value> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function expectedCookie(name: string, value: string) {
    const descriptor = { configurable: true, enumerable: true, writable: true, kind: 'data' };
    return {
        name, value, path: '/', proxy: false,
        prototype: 'Object.prototype', keys: ['name', 'value', 'path'],
        descriptors: { name: descriptor, value: descriptor, path: descriptor },
    };
}

test(`pins the real Next App Route cookies producer on Node ${EXPECTED_NODE}`, { timeout: 120_000 }, async () => {
    assert.equal(Number.parseInt(EXPECTED_NODE, 10), EXPECTED_NODE_MAJOR);
    assert.equal(process.versions.modules, EXPECTED_NODE_ABI);
    const installedNext = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/next/package.json'), 'utf8')) as {
        version: string;
    };
    assert.equal(installedNext.version, EXPECTED_NEXT);

    const fixture = mkdtempSync(path.join(ROOT, '.mediflow-next-cookie-producer-'));
    const nextFactory = (await import('next')).default;
    let application: ReturnType<typeof nextFactory> | null = null;
    let server: ReturnType<typeof createServer> | null = null;
    try {
        const routeDirectory = path.join(fixture, 'app/api/cookie-evidence');
        mkdirSync(routeDirectory, { recursive: true });
        writeFileSync(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}\n');
        writeFileSync(path.join(fixture, 'next.config.mjs'), 'export default {};\n');
        writeFileSync(path.join(routeDirectory, 'route.js'), ROUTE);

        const built = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'build', fixture], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
            timeout: 60_000,
            killSignal: 'SIGTERM',
        });
        assert.equal(built.status, 0, `${built.error?.message ?? ''}\n${built.stdout}\n${built.stderr}`);
        application = nextFactory({ dev: false, dir: fixture });
        server = createServer((request, response) => application!.getRequestHandler()(request, response));
        await bounded(application.prepare(), 30_000, 'Next prepare');
        const port = await listen(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/cookie-evidence`, {
            signal: AbortSignal.timeout(30_000),
            headers: {
                cookie: `mediflow_session=${SESSION_ID}; mediflow_auth_control=${CONTROL_ID}`,
            },
        });
        const body = await response.text();
        assert.equal(response.status, 200, body);
        const evidence = JSON.parse(body) as ProducerEvidence;
        assert.deepEqual(evidence, {
            node: EXPECTED_NODE,
            abi: EXPECTED_NODE_ABI,
            next: EXPECTED_NEXT,
            promise: { native: true, proxy: false, sameRealm: true },
            cookies: [
                expectedCookie('mediflow_session', SESSION_ID),
                expectedCookie('mediflow_auth_control', CONTROL_ID),
            ],
        });
    } finally {
        try {
            try {
                if (server) {
                    server.closeIdleConnections();
                    await bounded(new Promise<void>((resolve) => server!.close(() => resolve())), 5_000, 'HTTP close');
                }
            } finally {
                if (application) await bounded(application.close(), 5_000, 'Next close');
            }
        } finally {
            rmSync(fixture, { recursive: true, force: true });
        }
    }
});
