// Codex: created 2026-02-01
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { allowsNetworkIngress, isAgentOnlyIngress } from '../lib/security/network-ingress-policy.mjs';
import { isLoopbackAddress, proxyLoopbackHeaders } from '../lib/security/loopback-ingress.mjs';
import http from 'http';
import https from 'https';

const PAIRING_RATE_LIMITED_PATHS = new Set([
    '/api/v1/network/pairing-intents',
    '/api/v1/network/pairing-offers/redeem',
]);

export function createPairingRateLimiter({
    maxRequests = 20,
    windowMs = 60_000,
    maxTrackedIps = 1024,
    now = () => Date.now(),
} = {}) {
    const buckets = new Map();
    return function allow(remoteAddress) {
        const current = now();
        const key = typeof remoteAddress === 'string' && remoteAddress ? remoteAddress : 'unknown';
        const existing = buckets.get(key);
        if (existing && current < existing.resetAt) {
            if (existing.count >= maxRequests) {
                return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - current) / 1000)) };
            }
            existing.count += 1;
            return { allowed: true, retryAfterSeconds: 0 };
        }
        if (buckets.size >= maxTrackedIps) {
            for (const [trackedKey, bucket] of buckets) {
                if (current >= bucket.resetAt) buckets.delete(trackedKey);
            }
            if (buckets.size >= maxTrackedIps) {
                const oldestKey = buckets.keys().next().value;
                if (oldestKey !== undefined) buckets.delete(oldestKey);
            }
        }
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
    };
}

function isRateLimitedPairingRequest(method, targetUrl) {
    if (method !== 'POST' || typeof targetUrl !== 'string') return false;
    const pathname = targetUrl.split('?')[0];
    return PAIRING_RATE_LIMITED_PATHS.has(pathname);
}

function startProxyFromEnv() {
    const certPath = process.env.MEDIFLOW_TLS_CERT_PATH;
    const keyPath = process.env.MEDIFLOW_TLS_KEY_PATH;
    const port = Number(process.env.MEDIFLOW_TLS_PORT || 3443);
    const bindHost = process.env.MEDIFLOW_TLS_BIND_HOST || '127.0.0.1';
    const networkMode = process.env.MEDIFLOW_TLS_NETWORK_MODE || 'local-only';
    const target = new URL(process.env.MEDIFLOW_HTTP_TARGET || 'http://127.0.0.1:3000');
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    const rateLimitMax = Number(process.env.MEDIFLOW_TLS_PAIRING_RATE_LIMIT || 20);
    const rateLimitWindowMs = Number(process.env.MEDIFLOW_TLS_PAIRING_WINDOW_MS || 60_000);
    const allowPairingRequest = createPairingRateLimiter({
        maxRequests: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 20,
        windowMs: Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 60_000,
    });

    if (!certPath || !keyPath) {
        console.error('Missing MEDIFLOW_TLS_CERT_PATH or MEDIFLOW_TLS_KEY_PATH.');
        process.exit(1);
    }
    if (!loopbackHosts.has(target.hostname)) {
        console.error(`Invalid MEDIFLOW_HTTP_TARGET host: ${target.hostname}`);
        process.exit(1);
    }
    if (!loopbackHosts.has(bindHost) && networkMode !== 'network-home-base') {
        console.error(
            `Refusing LAN TLS bind on ${bindHost} while MEDIFLOW_TLS_NETWORK_MODE is ${networkMode}. ` +
            'Enable network-home-base first.',
        );
        process.exit(1);
    }

    const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
    };
    const enableLoopbackProbe = process.env.MEDIFLOW_TLS_LOOPBACK_PROBE === '1'
        && !loopbackHosts.has(bindHost)
        && bindHost !== '0.0.0.0'
        && bindHost !== '::';

    if (process.connected) process.once('disconnect', () => process.exit(0));

    const handleRequest = (req, res) => {
        const loopbackPeer = isLoopbackAddress(req.socket.remoteAddress);
        if (!loopbackPeer && !allowsNetworkIngress(req.method, req.url)) {
            const agentOnly = isAgentOnlyIngress(req.url);
            res.writeHead(agentOnly ? 404 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: agentOnly ? 'Not found' : 'Local access required' }));
            return;
        }
        if (!loopbackPeer && isRateLimitedPairingRequest(req.method, req.url)) {
            const verdict = allowPairingRequest(req.socket.remoteAddress);
            if (!verdict.allowed) {
                res.writeHead(429, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                    'Retry-After': String(verdict.retryAfterSeconds),
                });
                res.end(JSON.stringify({ error: 'Too Many Requests', code: 'PAIRING_RATE_LIMITED' }));
                return;
            }
        }
        const forwardedHeaders = {
            ...proxyLoopbackHeaders(req.headers, req.socket.remoteAddress),
            'x-forwarded-proto': 'https',
            'x-forwarded-host': req.headers.host || `${bindHost}:${port}`,
            'x-forwarded-port': String(port),
            'x-mediflow-tls-proxy': 'local-api',
        };
        if (req.socket.remoteAddress) {
            forwardedHeaders['x-forwarded-for'] = req.socket.remoteAddress;
        }

        const proxyRequest = http.request(
            {
                hostname: target.hostname,
                port: target.port,
                path: req.url,
                method: req.method,
                headers: forwardedHeaders
            },
            (proxyResponse) => {
                res.writeHead(proxyResponse.statusCode || 500, proxyResponse.headers);
                proxyResponse.pipe(res, { end: true });
            }
        );

        proxyRequest.on('error', (error) => {
            console.error('Proxy error:', error.message);
            res.writeHead(502);
            res.end('Bad Gateway');
        });

        req.pipe(proxyRequest, { end: true });
    };

    const server = https.createServer(options, handleRequest);
    const loopbackServer = enableLoopbackProbe ? https.createServer(options, handleRequest) : null;

    const announce = (listeningPort) => {
        console.log(`TLS proxy listening on https://${bindHost}:${listeningPort}`);
        console.log(`Forwarding to ${target.toString()}`);
        console.log(`Transport mode: ${networkMode}`);
    };

    const shutdown = () => {
        loopbackServer?.close();
        server.close(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    server.listen(port, bindHost, () => {
        const listeningPort = server.address().port;
        if (!loopbackServer) {
            announce(listeningPort);
            return;
        }
        loopbackServer.once('error', (error) => {
            console.error('Loopback probe listener error:', error.message);
            server.close(() => process.exit(1));
        });
        loopbackServer.listen(listeningPort, '127.0.0.1', () => {
            announce(listeningPort);
        });
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startProxyFromEnv();
}
