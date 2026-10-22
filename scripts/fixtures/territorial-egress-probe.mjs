import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

const directory = process.env.MEDIFLOW_TEST_EGRESS_REPORT_DIR;
if (!directory) throw new Error('Synthetic egress report directory required');
const report = path.join(directory, `egress-${process.pid}.json`);
const attempts = [];
fs.writeFileSync(report, JSON.stringify(attempts));
function deny() {
    attempts.push({ stack: new Error('synthetic network attempt').stack }); fs.writeFileSync(report, JSON.stringify(attempts));
    throw new Error('Synthetic egress probe blocked a network attempt');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const input = Array.isArray(args[0]) ? args[0] : args;
    const options = input[0];
    const host = typeof options === 'object' ? options.host : input[1];
    const local = typeof options === 'object' && options.path
        || ['127.0.0.1', '::1', 'localhost'].includes(host);
    if (process.env.MEDIFLOW_TEST_EGRESS_ALLOW_LOOPBACK === '1' && local) return Reflect.apply(connect, this, args);
    return deny();
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (process.env.MEDIFLOW_TEST_EGRESS_ALLOW_LOOPBACK === '1' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
        return originalFetch(input, init);
    }
    return deny();
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
    if (process.env.MEDIFLOW_TEST_EGRESS_ALLOW_LOOPBACK === '1' && ['localhost', '127.0.0.1', '::1'].includes(host)) {
        return lookup(host === 'localhost' ? '127.0.0.1' : host, ...args);
    }
    return deny();
};
dgram.Socket.prototype.send = deny;
syncBuiltinESMExports();
