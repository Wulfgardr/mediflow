// Codex: created 2026-02-01
import fs from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';

const certPath = process.env.MEDIFLOW_TLS_CERT_PATH;
const keyPath = process.env.MEDIFLOW_TLS_KEY_PATH;
const port = Number(process.env.MEDIFLOW_TLS_PORT || 3443);
const bindHost = process.env.MEDIFLOW_TLS_BIND_HOST || '127.0.0.1';
const networkMode = process.env.MEDIFLOW_TLS_NETWORK_MODE || 'local-only';
const target = new URL(process.env.MEDIFLOW_HTTP_TARGET || 'http://127.0.0.1:3000');
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

if (!certPath || !keyPath) {
    console.error('Missing MEDIFLOW_TLS_CERT_PATH or MEDIFLOW_TLS_KEY_PATH.');
    process.exit(1);
}
// @Codex
if (!loopbackHosts.has(target.hostname)) {
    console.error(`Invalid MEDIFLOW_HTTP_TARGET host: ${target.hostname}`);
    process.exit(1);
}
// @Codex
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

const server = https.createServer(options, (req, res) => {
    const forwardedHeaders = {
        ...req.headers,
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
});

// @Codex
server.listen(port, bindHost, () => {
    console.log(`TLS proxy listening on https://${bindHost}:${port}`);
    console.log(`Forwarding to ${target.toString()}`);
    console.log(`Transport mode: ${networkMode}`);
});
