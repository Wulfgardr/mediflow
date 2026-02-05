// Codex: created 2026-02-01
import fs from 'fs';
import http from 'http';
import https from 'https';
import { URL } from 'url';

const certPath = process.env.MEDIFLOW_TLS_CERT_PATH;
const keyPath = process.env.MEDIFLOW_TLS_KEY_PATH;
const port = Number(process.env.MEDIFLOW_TLS_PORT || 3443);
const target = new URL(process.env.MEDIFLOW_HTTP_TARGET || 'http://127.0.0.1:3000');

if (!certPath || !keyPath) {
    console.error('Missing MEDIFLOW_TLS_CERT_PATH or MEDIFLOW_TLS_KEY_PATH.');
    process.exit(1);
}
// @Codex
if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
    console.error(`Invalid MEDIFLOW_HTTP_TARGET host: ${target.hostname}`);
    process.exit(1);
}

const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
};

const server = https.createServer(options, (req, res) => {
    const proxyRequest = http.request(
        {
            hostname: target.hostname,
            port: target.port,
            path: req.url,
            method: req.method,
            headers: req.headers
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
server.listen(port, '127.0.0.1', () => {
    console.log(`TLS proxy listening on https://localhost:${port}`);
    console.log(`Forwarding to ${target.toString()}`);
});
