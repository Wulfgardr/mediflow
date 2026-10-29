import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { windowsProcessCreationTimeTicks } from './windows-system-command.mjs';

export function runtimeProcessIdentity(pid) {
  try {
    if (process.platform === 'win32') return windowsProcessCreationTimeTicks(pid);
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u)[19];
    }
    const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='],
      { encoding: 'utf8', timeout: 3000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
    return result.status === 0 && result.stdout.trim() || null;
  } catch { return null; }
}
const deny = () => { throw new Error('Proprietà del runtime non verificata.'); };
const jsonLines = (socket, receive) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 4096) return socket.destroy();
    const end = buffer.indexOf('\n');
    if (end >= 0) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { receive(JSON.parse(frame)); } catch { socket.destroy(); } }
  });
};
const send = (socket, value) => socket.write(JSON.stringify(value) + '\n');
export const sameOwner = (a, b) => a?.pid === b?.pid && a?.start === b?.start && a?.nonce === b?.nonce;
export function processOwner(identity, pid = process.pid) {
  const start = identity(pid);
  if (!start) return deny();
  return { pid, start, nonce: crypto.randomUUID() };
}
export function recordChildOwner(directory, child, identity) {
  const token = processOwner(identity, child.pid);
  const file = path.join(directory, `child-${token.nonce}.json`);
  fs.writeFileSync(file, JSON.stringify(token), { flag: 'wx', mode: 0o600 });
  return { token, file, identity };
}
export function verifyChildOwner(record, live = true) {
  const stat = fs.lstatSync(record.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096
    || process.getuid && stat.uid !== process.getuid()
    || !sameOwner(JSON.parse(fs.readFileSync(record.file, 'utf8')), record.token)
    || live && record.identity(record.token.pid) !== record.token.start) return deny();
}
export async function createRuntimeLeases({ directory, identity, initialPlugin, onIdle, binding = null }) {
  const owner = processOwner(identity);
  const key = crypto.createHash('sha256').update(directory).digest('hex');
  const temporary = process.platform === 'win32' ? null : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mf-lease-')));
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\mediflow-lease-${key}` : path.join(temporary, 'ipc');
  const clients = new Set(), manual = new Set(initialPlugin ? [] : ['owner']);
  /** @type {'accepting' | 'idle-pending' | 'stopping' | 'closed'} */
  let phase = 'accepting';
  let initial = initialPlugin, idleTask = null, closingTask = null;
  const beginStop = () => {
    clearImmediate(idleTask); idleTask = null; phase = 'stopping';
  };
  const idle = () => {
    if (initial || clients.size || manual.size || phase !== 'accepting') return;
    phase = 'idle-pending';
    idleTask = setImmediate(() => {
      idleTask = null; phase = 'accepting';
      if (initial || clients.size || manual.size) return;
      beginStop();
      void onIdle();
    });
  };
  const server = net.createServer(socket => {
    if (!['accepting', 'idle-pending'].includes(phase) || clients.size >= 256) return socket.destroy();
    clients.add(socket);
    const timer = setTimeout(() => socket.destroy(), 3000);
    socket.on('error', () => {});
    socket.once('close', () => { clearTimeout(timer); clients.delete(socket); idle(); });
    let admitted = false;
    jsonLines(socket, frame => {
      if (admitted || !sameOwner(frame.owner, owner) || !['plugin', 'manual', 'inspect'].includes(frame.kind)
        || !frame.client || !Number.isSafeInteger(frame.client.pid) || !/^[a-f0-9-]{36}$/u.test(frame.client.nonce)
        || identity(frame.client.pid) !== frame.client.start) return socket.destroy();
      admitted = true; clearTimeout(timer);
      if (frame.kind === 'inspect') {
        clients.delete(socket);
        socket.end(JSON.stringify({ owner, binding }) + '\n');
        return;
      }
      if (frame.kind === 'manual') manual.add(frame.client.nonce);
      send(socket, { owner, acquired: true });
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
  if (temporary) fs.chmodSync(address, 0o600);
  return {
    receipt: { address, owner },
    releaseInitial() { initial = false; idle(); },
    releaseManual() { manual.clear(); idle(); },
    requestStop() {
      initial = false; manual.clear();
      if (clients.size) { idle(); return false; }
      beginStop();
      return true;
    },
    get external() { return clients.size + [...manual].filter(value => value !== 'owner').length; },
    get active() { return Number(initial) + manual.size + clients.size; },
    close() {
      beginStop();
      for (const socket of clients) socket.destroy();
      return closingTask ??= new Promise(resolve => server.close(() => { phase = 'closed'; if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); resolve(); }));
    },
  };
}
export async function acquireRuntimeLease(receipt, identity, kind = 'plugin', channel = process) {
  validateLeaseAddress(receipt, identity);
  const socket = net.createConnection(receipt.address);
  let release;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Lease del runtime non disponibile.')), 3000);
    const fail = error => { clearTimeout(timer); socket.destroy(); reject(error); };
    socket.once('error', fail);
    socket.once('close', () => fail(new Error('Lease chiuso prima della conferma.')));
    socket.once('connect', () => send(socket, { owner: receipt.owner, client: processOwner(identity), kind }));
    jsonLines(socket, frame => {
      if (frame.acquired !== true || !sameOwner(frame.owner, receipt.owner)) return fail(new Error('Lease del runtime non valido.'));
      clearTimeout(timer); socket.off('error', fail); socket.on('error', () => {});
      release = () => { channel.off('disconnect', release); socket.destroy(); };
      channel.once('disconnect', release);
      if (channel.connected === false) { release(); reject(new Error('Client già disconnesso.')); return; }
      if (kind === 'manual') release();
      resolve();
    });
  });
  return release;
}

function validateLeaseAddress(receipt, identity) {
  if (!receipt?.address || !receipt.owner || identity(receipt.owner.pid) !== receipt.owner.start) return deny();
  if (typeof receipt.address !== 'string') return deny();
  if (process.platform === 'win32') {
    if (!receipt.address.startsWith('\\\\.\\pipe\\mediflow-lease-') || !/^[a-f0-9]{64}$/u.test(receipt.address.slice('\\\\.\\pipe\\mediflow-lease-'.length))) return deny();
  } else {
    const parent = path.dirname(receipt.address), stat = fs.lstatSync(parent);
    if (!path.isAbsolute(receipt.address) || path.basename(receipt.address) !== 'ipc'
      || !stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(parent) !== parent
      || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) return deny();
  }
}

export async function verifyRuntimeReceipt(receipt, identity = runtimeProcessIdentity) {
  if (receipt?.pid !== receipt?.lease?.owner?.pid) return deny();
  validateLeaseAddress(receipt.lease, identity);
  const socket = net.createConnection(receipt.lease.address);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Ricevuta del runtime non verificata.')), 3000);
      const fail = error => { clearTimeout(timer); socket.destroy(); reject(error); };
      socket.once('error', fail);
      socket.once('close', () => fail(new Error('Verifica della ricevuta interrotta.')));
      socket.once('connect', () => send(socket, { owner: receipt.lease.owner, client: processOwner(identity), kind: 'inspect' }));
      jsonLines(socket, frame => {
        if (!sameOwner(frame.owner, receipt.lease.owner) || !frame.binding
          || ['choiceUrl', 'dataDir', 'checkoutPath'].some(key => frame.binding[key] !== receipt[key])) return fail(new Error('Ricevuta del runtime non verificata.'));
        clearTimeout(timer); resolve();
      });
    });
  } finally { socket.destroy(); }
}
