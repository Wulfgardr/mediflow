import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { openUrl } from './launcher-helpers.mjs';

function privateDirectory(directory, create = false) {
  if (create) { try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory
    || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('navigation_unavailable');
}

export function pairingDirectory(lockDirectory) {
  const parent = path.dirname(lockDirectory);
  privateDirectory(parent);
  const directory = path.join(parent, 'pairing-requests');
  privateDirectory(directory, true);
  return directory;
}

export function readPairingRequests(directory) {
  privateDirectory(directory);
  const requests = [];
  for (const name of fs.readdirSync(directory).slice(0, 256)) {
    if (!/^[a-f0-9-]{36}\.json$/u.test(name)) continue;
    const file = path.join(directory, name);
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || (process.getuid && stat.uid !== process.getuid())
        || (process.platform !== 'win32' && (stat.mode & 0o077))) continue;
      const request = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (request.nonce + '.json' !== name) continue;
      fs.unlinkSync(file);
      if (Object.keys(request).sort().join(',') !== 'dataDir,expiresAt,host,nonce,returnPath,sourceFingerprint'
        || !/^[a-f0-9-]{36}$/u.test(request.host)
        || typeof request.returnPath !== 'string' || !path.isAbsolute(request.returnPath)
        || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= Date.now() || request.expiresAt > Date.now() + 60000) continue;
      requests.push(request);
    } catch { /* Untrusted rendezvous material never admits a peer. */ }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return requests;
}

export function frames(socket, receive) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 16384) { socket.destroy(); return; }
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) return;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { receive(JSON.parse(line)); } catch { socket.destroy(); return; }
    }
  });
}
export const writeFrame = (socket, frame) => { if (!socket.destroyed) socket.write(JSON.stringify(frame) + '\n'); };

export async function bridgeExistingLocalUi(directory, expected, channel = process, showCode = openUrl) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-ui-')));
  fs.chmodSync(temporary, 0o700);
  const returnPath = process.platform === 'win32' ? `\\\\.\\pipe\\mf-ui-${crypto.randomUUID()}` : path.join(temporary, 'ipc');
  const nonce = crypto.randomUUID(), token = crypto.randomBytes(12).toString('hex'), host = crypto.randomUUID();
  const file = path.join(directory, `${nonce}.json`);
  let peer = null, connected = false, closed = false;
  const sockets = new Set();
  const codePath = '/' + crypto.randomUUID();
  const codePage = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== codePath || request.headers.host !== `127.0.0.1:${codePage.address().port}`) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'",
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    response.end(`<!doctype html><html lang="it"><meta charset="utf-8"><title>Collega MediFlow</title><body style="font:20px system-ui;max-width:40rem;margin:4rem auto;padding:1rem"><h1>Collega la MediFlow già aperta</h1><p>Copia questo codice nella MediFlow che stavi usando, poi premi «Consenti».</p><p><code style="font-size:1.5rem">${token}</code></p><p>Il codice scade entro un minuto. Non inserirlo nella chat o in una pagina aperta da altri collegamenti.</p></body></html>`);
  });
  const server = net.createServer(socket => {
    if (peer || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket); socket.setTimeout(1000, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    frames(socket, frame => {
      if (!connected) {
        if (frame?.type === 'paired' && frame.nonce === nonce && frame.status === 'denied') { close(); return; }
        if (frame?.type !== 'paired' || typeof frame.token !== 'string' || frame.token.length !== token.length || !crypto.timingSafeEqual(Buffer.from(frame.token), Buffer.from(token)) || frame.nonce !== nonce
          || frame.dataDir !== expected.dataDir || frame.sourceFingerprint !== expected.sourceFingerprint) { socket.destroy(); return; }
        if (frame.status !== 'accepted') { close(); return; }
        peer = socket; connected = true; socket.setTimeout(0); clearTimeout(timer); codePage.close(); codePage.closeAllConnections();

      } else if (frame?.type === 'mediflow-local-ui-result' && channel.connected) {
        channel.send({ type: frame.type, requestId: frame.requestId,
          status: ['accepted', 'waiting'].includes(frame.status) ? frame.status : 'denied' }, () => {});
      }
    });
    socket.once('close', () => { if (peer === socket) close(); });
  });
  const receive = frame => {
    if (!['mediflow-local-ui-navigate', 'mediflow-local-ui-cancel'].includes(frame?.type)) return;
    if (!connected) {
      if (frame.type === 'mediflow-local-ui-navigate' && channel.connected) channel.send({ type: 'mediflow-local-ui-result', requestId: frame.requestId, status: 'waiting' }, () => {});
      return;
    }
    writeFrame(peer, frame);
  };
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer);
    channel.off('message', receive); channel.off('disconnect', close);
    for (const socket of sockets) socket.destroy(); server.close(); codePage.close(); codePage.closeAllConnections(); fs.rmSync(file, { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
    if (channel.connected) channel.disconnect();
  };
  const timer = setTimeout(close, 60000);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(returnPath, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(returnPath, 0o600);
    fs.writeFileSync(file, JSON.stringify({ ...expected, nonce, host, returnPath, expiresAt: Date.now() + 60000 }), { flag: 'wx', mode: 0o600 });
    channel.on('message', receive); channel.once('disconnect', close);
    await new Promise((resolve, reject) => { codePage.once('error', reject); codePage.listen(0, '127.0.0.1', resolve); });
    showCode(`http://127.0.0.1:${codePage.address().port}${codePath}`);
    if (channel.connected) channel.send({ type: 'mediflow-local-ui-connected', ...expected }, () => {});
  } catch (error) { close(); throw error; }
  return close;
}
