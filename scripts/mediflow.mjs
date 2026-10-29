#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { checkNode, knownMainUpdates, openUrl, probeRunningInstance, readProductIdentity, waitForRunningInstance } from './launcher-helpers.mjs';
import { verifySourceRuntime } from './source-runtime.mjs';
import { initializeWindowsSystemCommand, windowsTaskkillCommand, windowsProcessCreationTimeTicks } from './windows-system-command.mjs';
import { macDerivedDataDirectory } from './build-input-metadata.mjs';
import { createChoiceServer } from './mediflow-launcher-page.mjs';
import { containWindowsWeb } from './windows-runtime-job.mjs';
import { createRuntimeLeases, acquireRuntimeLease, recordChildOwner, verifyChildOwner, runtimeProcessIdentity } from './runtime-leases.mjs';
import { prepareLauncherState, localUiArchiveLock } from './launcher-state.mjs';
import { verifyOwnedWeb } from './local-ui-web-identity.mjs';
import { pairingDirectory, readPairingRequests, bridgeExistingLocalUi, frames, writeFrame } from './local-ui-pairing-transport.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHOICES = ['web', 'mac', 'agenti', 'sviluppo'];
const log = message => process.stderr.write(`${message}\n`);

export function parseArguments(args) {
  const options = { choose: false, noBrowser: false, choice: null, desktop: false, reuseOnly: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--scegli') options.choose = true;
    else if (arg === '--senza-browser') options.noBrowser = true;
    else if (arg === '--riusa') options.reuseOnly = true;
    else if (arg === 'install-desktop-entry') options.desktop = true;
    else if (arg === '--scelta' && CHOICES.includes(args[index + 1])) options.choice = args[++index];
    else throw new Error(`Argomento non valido: ${arg}. Usa --scegli, --scelta web|mac|agenti|sviluppo o --senza-browser.`);
  }
  return options;
}

export function selectChoice({ explicit, remembered, forceChoice, nativeAvailable, dirty }) {
  const allowed = choice => CHOICES.includes(choice) && (choice !== 'mac' || nativeAvailable) && (choice !== 'sviluppo' || dirty);
  if (explicit) {
    if (!allowed(explicit)) throw new Error('La scelta richiesta non è disponibile in questa cartella.');
    return explicit;
  }
  if (forceChoice || dirty || remembered === 'sviluppo') return null;
  return allowed(remembered) ? remembered : null;
}

export function buildDecision(identity, verified) {
  if (identity.worktreeHash !== 'clean') return 'development-only';
  if (identity.revision === 'unknown') throw new Error('Revisione Git non disponibile. Usa una copia Git completa per costruire MediFlow.');
  return verified?.identity?.revision?.slice(0, 12) === identity.revision
    && verified.identity.sourceFingerprint === identity.sourceFingerprint ? 'reuse' : 'build';
}

export function needsTextMenu(platform = process.platform, env = process.env, browserStatus = 0) {
  return browserStatus !== 0 || (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}

export async function textualChoice({ nativeAvailable, dirty, question, write = log }) {
  const entries = [['web', 'Nel browser'],
    ...(nativeAvailable ? [['mac', 'App per Mac']] : []),
    ['agenti', 'Per un agente: collegamento locale per un client autorizzato'],
    ...(dirty ? [['sviluppo', 'Apri per sviluppo: modifiche non committate']] : []),
    ['stop', 'Arresta']];
  entries.forEach(([, label], index) => write(`${index + 1}. ${label}`));
  while (true) {
    const answer = (await question('Scelta [1]: ')).trim() || '1';
    const choice = entries[Number(answer) - 1]?.[0];
    if (choice) return choice;
    write('Inserisci il numero di una delle scelte.');
  }
}

export function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function nativeApplication(root) {
  if (process.platform !== 'darwin') return null;
  const app = path.join(macDerivedDataDirectory(root),
    'Build/Products', process.env.MEDIFLOW_MAC_CONFIG || 'Debug', 'MediFlow.app');
  const binary = path.join(app, 'Contents/MacOS/MediFlow');
  return fs.existsSync(binary) ? binary : null;
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export async function findExistingInstance(receipt, identity, probe = probeRunningInstance) {
  if (receipt?.checkoutPath !== identity.checkoutPath || !alive(receipt.pid)) return null;
  if (!receipt.choiceUrl) throw new Error('Un avvio di questa cartella è già in corso. Controlla il terminale e riprova.');
  const url = new URL(receipt.choiceUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Indirizzo del lanciatore non valido.');
  const response = await fetch(new URL('state', url), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Il lanciatore di questa cartella non risponde. Controlla il suo terminale.');
  const state = await response.json();
  if (state.ready && state.url) {
    if (!(await probe(state.url, identity.sourceFingerprint)).ok) throw new Error('L’istanza attiva non corrisponde ai sorgenti attuali. Arrestala dal suo terminale prima di rilanciare.');
    return { url: state.url, choiceUrl: receipt.choiceUrl };
  }
  return { url: receipt.choiceUrl, choiceUrl: receipt.choiceUrl };
}

export async function requireFreePort(port) {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', () => reject(new Error(`La porta ${port} non è disponibile. Nessun processo esistente è stato arrestato. Scegli un’altra PORT o arresta l’altra istanza dal suo terminale.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}

export function launcherProcessIdentity(pid) {
  try {
    let value;
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      value = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
        + ':' + stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u)[19];
    } else if (process.platform === 'win32') {
      value = windowsProcessCreationTimeTicks(pid);
    } else {
      const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='],
          { encoding: 'utf8', timeout: 3000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
      if (result.status !== 0 || !result.stdout.trim()) return null;
      value = result.stdout.trim();
    }
    return crypto.createHash('sha256').update(value).digest('hex');
  } catch { return null; }
}

function privateLauncherDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Stato di avvio non valido.');
  }
}

function launcherPathExists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function readLauncherJson(file, incomplete = false, singleLink = true) {
  let leaf;
  try { leaf = fs.lstatSync(file); }
  catch (error) { if (incomplete && error.code === 'ENOENT') return null; throw error; }
  if (!leaf.isFile() || leaf.isSymbolicLink()) throw new Error('Stato di avvio non valido.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const receiptStat = fs.fstatSync(fd);
    if (!receiptStat.isFile() || receiptStat.dev !== leaf.dev || receiptStat.ino !== leaf.ino
      || (singleLink && receiptStat.nlink !== 1) || receiptStat.size > 4096
      || (process.getuid && receiptStat.uid !== process.getuid())) throw new Error('Stato di avvio non valido.');
    const bytes = fs.readFileSync(fd, 'utf8');
    try { return JSON.parse(bytes); }
    catch (error) { if (incomplete && error instanceof SyntaxError) return null; throw error; }
  } finally { fs.closeSync(fd); }
}

function staleLauncherOwner(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) throw new Error('Stato di avvio non valido.');
  if (!alive(owner.pid)) return true;
  const current = launcherProcessIdentity(owner.pid);
  return typeof owner.processIdentity === 'string' && current !== null && current !== owner.processIdentity;
}

const LAUNCHER_LOCK_PROTOCOL = 'mediflow.launcher-lock.v2';
const legacyLauncherState = () => new Error('Stato legacy del lanciatore senza proprietario verificabile. Recupero automatico sospeso: occorre verificare la quiescenza dei launcher di questa cartella prima di intervenire sullo stato.');

function ensureLauncherProtocol(directory, candidate) {
  const guard = `${directory}.recovery`;
  const inspect = () => {
    let value;
    try {
      value = readLauncherJson(guard, false, false);
    } catch { throw legacyLauncherState(); }
    if (value?.schema === LAUNCHER_LOCK_PROTOCOL && Object.keys(value).length === 1) return;
    throw legacyLauncherState();
  };
  if (launcherPathExists(guard)) { inspect(); return; }
  if (launcherPathExists(directory)) launcherState(directory);
  const prepared = path.join(candidate, 'guard.json');
  atomicJson(prepared, { schema: LAUNCHER_LOCK_PROTOCOL });
  try { fs.linkSync(prepared, guard); }
  catch (error) { if (error.code !== 'EEXIST') throw error; inspect(); }
  fs.unlinkSync(prepared);
}

function launcherState(directory) {
  privateLauncherDirectory(directory);
  const protocolFile = path.join(directory, 'protocol.json');
  const legacyFile = path.join(directory, 'instance.json');
  if (!launcherPathExists(protocolFile)) {
    if (!launcherPathExists(legacyFile)) throw legacyLauncherState();
    const receipt = readLauncherJson(legacyFile, true);
    if (!receipt || !Number.isSafeInteger(receipt.pid) || receipt.pid < 1) throw legacyLauncherState();
    return { legacy: true, receiptFile: legacyFile, receipt };
  }
  if (readLauncherJson(protocolFile)?.schema !== LAUNCHER_LOCK_PROTOCOL) throw new Error('Stato di avvio non valido.');
  if (launcherPathExists(legacyFile)) {
    const receipt = readLauncherJson(legacyFile, true);
    if (!receipt || !Number.isSafeInteger(receipt.pid) || receipt.pid < 1) throw legacyLauncherState();
    return { legacy: true, receiptFile: legacyFile, receipt };
  }
  const active = path.join(directory, 'active');
  if (!launcherPathExists(active)) return { empty: true };
  privateLauncherDirectory(active);
  const entries = fs.readdirSync(active);
  if (!entries.length) return { empty: true, active };
  if (entries.length !== 1 || !/^owner-[a-f0-9]{32}$/u.test(entries[0])) throw new Error('Stato di avvio non valido.');
  const generation = entries[0], owned = path.join(active, generation);
  privateLauncherDirectory(owned);
  const owner = readLauncherJson(path.join(owned, 'owner.json'));
  const receiptFile = path.join(owned, 'instance.json');
  let receipt = readLauncherJson(receiptFile, true);
  if (!Number.isSafeInteger(receipt?.pid) || typeof receipt?.processIdentity !== 'string'
    || typeof receipt?.checkoutPath !== 'string') receipt = null;
  if (receipt && (receipt.pid !== owner.pid || receipt.processIdentity !== owner.processIdentity
    || receipt.checkoutPath !== owner.checkoutPath)) throw new Error('Stato di avvio non valido.');
  return { generation, receiptFile, receipt: receipt ?? owner, owner };
}

function detachLauncherGeneration(directory, generation) {
  const retired = `${directory}.retired-${crypto.randomUUID()}`;
  fs.renameSync(path.join(directory, 'active', generation), retired);
  try { fs.rmdirSync(path.join(directory, 'active')); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  fs.rmSync(retired, { recursive: true, force: true });
}

export function releaseLauncher(ownership) {
  if (ownership.claimed) detachLauncherGeneration(ownership.directory, ownership.generation);
}

export function claimLauncher(directory, identity, { reuseLive = false } = {}) {
  const processIdentity = launcherProcessIdentity(process.pid);
  if (!processIdentity) throw new Error('Impossibile verificare l’identità del processo lanciatore.');
  const receipt = { pid: process.pid, processIdentity, checkoutPath: identity.checkoutPath };
  const generation = `owner-${crypto.randomBytes(16).toString('hex')}`;
  const candidate = `${directory}.candidate-${crypto.randomUUID()}`;
  fs.mkdirSync(candidate, { mode: 0o700 });
  try {
    const prepared = path.join(candidate, 'active', generation);
    fs.mkdirSync(prepared, { recursive: true, mode: 0o700 });
    atomicJson(path.join(candidate, 'protocol.json'), { schema: LAUNCHER_LOCK_PROTOCOL });
    atomicJson(path.join(prepared, 'owner.json'), receipt);
    atomicJson(path.join(prepared, 'instance.json'), receipt);
    ensureLauncherProtocol(directory, candidate);
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        let state;
        if (!launcherPathExists(directory)) fs.renameSync(candidate, directory);
        else {
          state = launcherState(directory);
          if (state.empty) {
            if (state.active) fs.rmdirSync(state.active);
            fs.renameSync(path.join(candidate, 'active'), path.join(directory, 'active'));
          } else {
            if (!staleLauncherOwner(state.owner ?? state.receipt)) {
              if (reuseLive) return { claimed: false, directory, ...state };
              throw new Error('Un avvio di questa cartella è già in corso. Controlla il terminale e riprova.');
            }
            if (state.legacy) {
              atomicJson(path.join(directory, 'protocol.json'), { schema: LAUNCHER_LOCK_PROTOCOL });
              fs.unlinkSync(state.receiptFile);
            } else detachLauncherGeneration(directory, state.generation);
            continue;
          }
        }
        return { claimed: true, directory, generation, receipt,
          receiptFile: path.join(directory, 'active', generation, 'instance.json') };
      } catch (error) {
        if (!['ENOENT', 'EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        if (!launcherPathExists(directory)) throw error;
      }
    }
    throw new Error('Stato di avvio cambiato durante l’acquisizione. Riprova.');
  } finally { fs.rmSync(candidate, { recursive: true, force: true }); }
}

const terminalOwnedGroups = new WeakSet();
const confirmedWindowsStops = new WeakSet();

export async function stopOwnedChild(child, graceMs = 8000, options = {}) {
  const ownerRecord = options.ownerRecord ?? null;
  const posix = process.platform !== 'win32';
  if (!child?.pid) return;
  if (!posix && (child.exitCode !== null || child.signalCode !== null)) {
    if (confirmedWindowsStops.has(child)) return;
    throw Object.assign(new Error('Arresto del processo posseduto non verificato.', { cause: new Error('Albero del processo già terminale non verificato.') }), { code: 'MEDIFLOW_OWNED_STOP_UNCONFIRMED' });
  }
  const windowsCommand = posix ? null : windowsTaskkillCommand();
  await new Promise((resolve, reject) => {
    let forceTimer, timer, signalImmediate, groupAbsent = terminalOwnedGroups.has(child), settled = false;
    let windowsTreeStopped = false, originalExitObserved = false;
    const finish = cause => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer); clearTimeout(timer); child.off('exit', exited);
      clearImmediate(signalImmediate);
      if (cause) reject(Object.assign(new Error('Arresto del processo posseduto non verificato.', { cause }), { code: 'MEDIFLOW_OWNED_STOP_UNCONFIRMED' }));
      else resolve();
    };
    const groupExists = () => {
      if (groupAbsent) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
        groupAbsent = true;
        terminalOwnedGroups.add(child);
        clearTimeout(forceTimer);
        clearImmediate(signalImmediate);
        return false;
      }
    };
    const leaderTerminal = () => child.exitCode !== null || child.signalCode !== null;
    const requireOwnedLeader = () => {
      if (leaderTerminal()) throw new Error('Continuità del gruppo posseduto non verificabile dopo la fine del capogruppo.');
      if (ownerRecord) verifyChildOwner(ownerRecord);
    };
    const observe = () => {
      if (settled) return;
      try {
        if (groupExists()) requireOwnedLeader();
        else if (leaderTerminal()) { finish(); return; }
      } catch (error) { finish(error); }
    };
    const exited = () => {
      if (posix) { observe(); return; }
      originalExitObserved = true;
      if (Date.now() >= deadline) expired();
      else if (windowsTreeStopped) finish();
    };
    const deadline = Date.now() + graceMs;
    const expired = () => finish(new Error(posix ? 'Exit del processo posseduto o scomparsa del gruppo non osservato.' : 'Exit del processo posseduto non osservato.'));
    const signalGroup = signal => {
      clearImmediate(signalImmediate);
      signalImmediate = setImmediate(() => {
        signalImmediate = null;
        if (settled) return;
        if (Date.now() >= deadline) { expired(); return; }
        try {
          if (!groupExists()) { observe(); return; }
          requireOwnedLeader();
          process.kill(-child.pid, signal);
        } catch (error) { if (error.code === 'ESRCH') observe(); else finish(error); }
      });
    };
    const force = () => {
      if (settled) return;
      try {
        if (process.platform === 'win32') {
          if (Date.now() >= deadline) { expired(); return; }
          if (leaderTerminal()) throw new Error('Albero del processo già terminale non verificato.');
          if (ownerRecord) verifyChildOwner(ownerRecord);
          const result = spawnSync(windowsCommand, ['/pid', String(child.pid), '/T', '/F'],
            { stdio: 'ignore', timeout: Math.max(1, deadline - Date.now()), windowsHide: true });
          if (result.error || result.status !== 0) throw result.error || new Error(`taskkill: ${result.status}`);
          if (Date.now() >= deadline) { expired(); return; }
          windowsTreeStopped = true;
          if (originalExitObserved) finish();
        } else signalGroup('SIGKILL');
      } catch (error) { if (posix && error.code === 'ESRCH') observe(); else finish(error); }
    };
    child.once('exit', exited);
    timer = setTimeout(expired, graceMs);
    try {
      if (posix) {
        if (leaderTerminal() || groupAbsent) { observe(); return; }
        forceTimer = setTimeout(force, Math.floor(graceMs / 2));
        signalGroup('SIGTERM');
      } else force();
    } catch (error) { if (posix && error.code === 'ESRCH') observe(); else finish(error); }
  });
  if (!posix) confirmedWindowsStops.add(child);
}

export function installDesktopEntry(root = ROOT, home = os.homedir()) {
  if (process.platform !== 'linux') throw new Error('Il collegamento al menu è disponibile solo su Linux.');
  const directory = path.join(home, '.local/share/applications');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const quote = value => `"${value.replace(/[\\"`$]/gu, c => `\\${c}`).replaceAll('%', '%%')}"`;
  if (/[\r\n]/u.test(root)) throw new Error('Percorso non valido per il collegamento.');
  const output = path.join(directory, 'mediflow.desktop');
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `[Desktop Entry]\nType=Application\nName=MediFlow\nExec=${quote(path.join(root, 'MediFlow.sh'))}\nIcon=${path.join(root, 'app/icon.svg').replaceAll('\\', '\\\\')}\nTerminal=true\nCategories=Office;MedicalSoftware;\n`, { mode: 0o755, flag: 'wx' });
    fs.renameSync(temporary, output);
  } finally { fs.rmSync(temporary, { force: true }); }
  return output;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  process.chdir(ROOT);
  const runtime = checkNode();
  if (!runtime.ok) throw new Error(runtime.error);
  initializeWindowsSystemCommand();
  if (options.desktop) { log(`Collegamento creato: ${installDesktopEntry()}`); return; }
  if (knownMainUpdates(ROOT)) throw new Error('Questa copia non contiene aggiornamenti già noti a Git. Esegui git pull --ff-only e riapri MediFlow.');
  const identity = readProductIdentity(ROOT);
  const configuredDataDir = process.env.MEDIFLOW_DATA_DIR || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/MediFlow') : path.join(os.homedir(), '.mediflow'));
  const dataDir = fs.existsSync(configuredDataDir) ? fs.realpathSync(configuredDataDir) : path.resolve(configuredDataDir);
  const { preferencesFile, lockDirectory } = prepareLauncherState(ROOT);
  const pluginChannel = options.reuseOnly && process.connected;
  const ownership = claimLauncher(lockDirectory, identity, { reuseLive: true });
  if (!ownership.claimed && ownership.receipt.dataDir && ownership.receipt.dataDir !== dataDir) {
    throw new Error('Questa cartella usa già un archivio diverso. Apri l’istanza corretta.');
  }
  let archiveOwnership = null;
  if (ownership.claimed) {
    const archiveLock = localUiArchiveLock(dataDir);
    try { archiveOwnership = claimLauncher(archiveLock, identity, { reuseLive: true }); }
    catch (error) { releaseLauncher(ownership); throw error; }
    if (!archiveOwnership.claimed) {
      releaseLauncher(ownership);
      if (!pluginChannel) {
        const existing = await findExistingInstance(archiveOwnership.receipt,
          { ...identity, checkoutPath: archiveOwnership.receipt.checkoutPath });
        if (!existing || existing.url === existing.choiceUrl) throw new Error('Un altro avvio di questo archivio è in corso. Attendi e riprova.');
        await acquireRuntimeLease(archiveOwnership.receipt.lease, runtimeProcessIdentity, 'manual');
        const url = options.choose ? `${existing.choiceUrl}?scegli=1` : existing.url;
        log(`MediFlow è già attivo per questo archivio: ${url}`);
        if (!options.noBrowser && !needsTextMenu()) openUrl(url);
        return;
      }
      await acquireRuntimeLease(archiveOwnership.receipt.lease, runtimeProcessIdentity);
      await bridgeExistingLocalUi(pairingDirectory(archiveLock), { dataDir, sourceFingerprint: identity.sourceFingerprint }, process, options.noBrowser ? () => {} : undefined);
      return;
    }
  }
  const existing = pluginChannel || ownership.claimed ? null : await findExistingInstance(ownership.receipt, identity);
  if (existing) {
    await acquireRuntimeLease(ownership.receipt.lease, runtimeProcessIdentity, 'manual');
    const url = options.choose ? `${existing.choiceUrl}?scegli=1` : existing.url;
    log(`MediFlow è già attivo da questa cartella: ${url}`);
    if (!options.noBrowser && !needsTextMenu()) openUrl(url);
    return;
  }
  const requestsDirectory = pairingDirectory(lockDirectory);
  const archiveRequests = archiveOwnership ? pairingDirectory(archiveOwnership.directory) : null;
  if (pluginChannel && !ownership.claimed) {
    await acquireRuntimeLease(ownership.receipt.lease, runtimeProcessIdentity);
    await bridgeExistingLocalUi(requestsDirectory, { dataDir, sourceFingerprint: identity.sourceFingerprint }, process, options.noBrowser ? () => {} : undefined);
    return;
  }
  if (!ownership.claimed) throw new Error('Un avvio di questa cartella è già in corso. Controlla il terminale e riprova.');
  const native = nativeApplication(ROOT);
  const dirty = identity.worktreeHash !== 'clean';
  let state = { busy: false, ready: false, url: null, message: 'Scegli come aprire MediFlow.', needsInstall: false };
  let child = null, chooser = null, closing = false, installApproval = null, failedBuild = null, generation = 0;
  let terminal = null, useTerminal = false, webSecret = null, instance = null;
  const pairRequests = new Map();
  const ipcStopChildren = new WeakSet();
  let childOwner = null, leases = null, webJob = null;
  const stopChild = () => {
    if (child && child.exitCode === null && child.signalCode === null && leases?.external) {
      throw new Error('MediFlow è ancora utilizzato da un altro client.');
    }
    return webJob ? webJob.stop() : stopOwnedChild(child, 8000, { ownerRecord: childOwner });
  };
  let pairingPoll = null;
  let shutdownTask = null, shutdownComplete = false, ownershipHold = null;
  const question = async prompt => {
    if (!process.stdin.isTTY) throw new Error('Serve una scelta esplicita. Usa --scelta web --senza-browser, oppure --scelta sviluppo per sviluppo.');
    terminal ||= createInterface({ input: process.stdin, output: process.stderr });
    return terminal.question(prompt);
  };
  const update = patch => { Object.assign(state, patch); if (patch.message) log(patch.message); };
  const run = (executable, argv, ipc = false, env = process.env) => {
    child = spawn(executable, argv, { cwd: ROOT, env, detached: process.platform !== 'win32',
      stdio: ipc ? ['inherit', 'inherit', 'pipe', 'ipc'] : ['ignore', 2, 2] });
    const owned = child;
    childOwner = recordChildOwner(path.dirname(ownership.receiptFile), owned, runtimeProcessIdentity);
    owned.on('error', error => log(`Avvio non riuscito: ${error.message}`));
    return owned;
  };
  const runNpm = async command => {
    const owned = process.platform === 'win32'
      ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${command}`])
      : run('npm', command === 'ci' ? ['ci'] : ['run', 'build']);
    await new Promise((resolve, reject) => {
      owned.once('error', reject);
      owned.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`npm ${command} non completato (${signal || code}). Controlla i log e riprova.`)));
    });
    if (closing) throw new Error('Avvio interrotto.');
  };
  const shutdown = (stopError = null) => {
    if (shutdownComplete) return Promise.resolve(true);
    if (shutdownTask) return shutdownTask;
    closing = true;
    update({ ready: false, navigationReady: false, url: null, message: 'Arresto in corso.' });
    clearInterval(pairingPoll);
    for (const pair of pairRequests.values()) pair.socket?.destroy();
    pairRequests.clear();
    installApproval?.(false);
    terminal?.close();
    shutdownTask = Promise.resolve().then(async () => {
      try {
        if (stopError) throw stopError;
        await stopChild();
        await chooser?.close();
        await leases?.close();
        releaseLauncher(ownership);
        if (archiveOwnership) releaseLauncher(archiveOwnership);
        clearInterval(ownershipHold); ownershipHold = null;
        shutdownComplete = true;
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, onSignal);
        process.off('message', onParentMessage);
        process.off('disconnect', onDisconnect);
        if (process.connected) process.disconnect();
        log('MediFlow arrestato.');
        return true;
      } catch (error) {
        ownershipHold ||= setInterval(() => {}, 1000);
        process.exitCode = 1;
        update({ busy: false, step: 'errore', message: `Arresto non verificato. Proprietà conservata; riprova Arresta dopo aver controllato il processo. ${error.message}` });
        return false;
      } finally { shutdownTask = null; }
    });
    return shutdownTask;
  };
  const onSignal = () => {
    leases?.releaseInitial(); leases?.releaseManual();
    if (!leases || closing && !leases.active) void shutdown();
  };
  const pendingNavigation = new Set();
  const navigationControllers = new Map();
  const rememberNavigation = requestId => {
    if (pendingNavigation.size >= 256) return false;
    pendingNavigation.add(requestId);
    setTimeout(() => pendingNavigation.delete(requestId), 8000).unref();
    return true;
  };
  const cancelNavigation = requestId => {
    navigationControllers.get(requestId)?.abort();
    if (state.navigationReady && child?.connected && ipcStopChildren.has(child)) child.send(JSON.stringify({ schemaVersion: 'mediflow.local-ui.cancel.v1', requestId }), () => {});
  };
  const navigate = async (intent, request, pair = null) => {
    request.signal.throwIfAborted();
    if (!state.navigationReady || !state.ready || !state.url || !child?.connected || child.exitCode !== null || child.signalCode !== null) throw new Error('Navigazione non disponibile.');
    if (!await verifyOwnedWeb(state.url, webSecret)) {
      ipcStopChildren.delete(child);
      throw new Error('identità Web non verificata.');
    }
    ipcStopChildren.add(child);
    request.signal.throwIfAborted();
    const navigation = JSON.stringify({ schemaVersion: 'mediflow.local-ui.navigation.v1', intent, requestId: request.requestId, expiresAt: request.expiresAt });
    if (pair) {
      const owned = child;
      await new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); owned.off('message', receive); request.signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => finish(new Error('Navigazione non disponibile.'));
        const receive = frame => {
          if (frame?.type === 'mediflow-local-ui-pair-result' && frame.requestId === request.requestId) finish(frame.status === 'accepted' ? null : new Error('Navigazione non disponibile.'));
        };
        const timer = setTimeout(abort, Math.max(1, request.expiresAt - Date.now()));
        owned.on('message', receive); request.signal.addEventListener('abort', abort, { once: true });
        owned.send({ type: 'mediflow-local-ui-pair-use', nonce: pair.nonce, host: pair.host, requestId: request.requestId, navigation }, error => { if (error) abort(); });
      });
    } else await new Promise((resolve, reject) => child.send(navigation, error => error ? reject(new Error('Navigazione non disponibile.')) : resolve()));
  };
  const handleNavigation = async (message, reply, isConnected, pair = null) => {
    if (message?.type === 'mediflow-launcher-stop') { if (!pair && !pluginChannel) onSignal(); return; }
    if ((!pluginChannel && !pair) || typeof message?.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(message.requestId)) return;
    const { requestId } = message;
    if (message.type === 'mediflow-local-ui-cancel') {
      if (Object.keys(message).sort().join(',') !== 'requestId,type') return;
      if (!pendingNavigation.has(requestId)) rememberNavigation(requestId);
      cancelNavigation(requestId); return;
    }
    if (message.type !== 'mediflow-local-ui-navigate') return;
    let status = 'denied';
    if (Object.keys(message).sort().join(',') === 'dataDir,expiresAt,intent,requestId,sourceFingerprint,type'
      && message.dataDir === dataDir && message.sourceFingerprint === identity.sourceFingerprint
      && !pendingNavigation.has(requestId)
      && ['search', 'identity', 'history', 'prescribing'].includes(message.intent)
      && Number.isSafeInteger(message.expiresAt) && message.expiresAt > Date.now() && message.expiresAt <= Date.now() + 8000
      && rememberNavigation(requestId)) {
      if (!state.ready && !closing && state.step !== 'errore') status = 'waiting';
      else {
        const controller = new AbortController(); navigationControllers.set(requestId, controller);
        try {
          await navigate(message.intent, { requestId, expiresAt: message.expiresAt, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(message.expiresAt - Date.now())]) }, pair);
          status = isConnected() ? 'accepted' : 'denied';
        } catch { cancelNavigation(requestId); }
        finally { navigationControllers.delete(requestId); }
      }
    }
    if (isConnected()) reply({ type: 'mediflow-local-ui-result', requestId, status });
  };
  const onParentMessage = message => handleNavigation(message, frame => process.send(frame, () => {}), () => process.connected);
  const onDisconnect = () => {
    for (const requestId of pendingNavigation) cancelNavigation(requestId);
    if (pluginChannel && leases) leases.releaseInitial();
    else onSignal();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);
  if (process.connected) {
    process.on('message', onParentMessage);
    process.once('disconnect', onDisconnect);
    if (pluginChannel) process.send({ type: 'mediflow-local-ui-connected', dataDir, sourceFingerprint: identity.sourceFingerprint }, () => {});
  }
  const startOptionalOllama = () => {
    void fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(300) }).then(response => {
      if (!response.ok) throw new Error('not-ready');
    }).catch(() => {
      if (closing) return;
      const service = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true });
      service.on('error', () => {}); service.unref();
    });
  };
  const start = async (choice, remember) => {
    const attempt = ++generation;
    update({ busy: true, ready: false, navigationReady: false, url: null, step: 'dipendenze', message: 'Controllo delle dipendenze.' });
    await stopChild();
    if (closing) return;
    if (!fs.existsSync(path.join(ROOT, 'node_modules/next/package.json')) || !fs.existsSync(path.join(ROOT, 'node_modules/better-sqlite3/package.json'))) {
      update({ needsInstall: true, message: 'Mancano le dipendenze. Conferma l’installazione con npm ci.' });
      let approved;
      if (options.noBrowser || needsTextMenu()) approved = /^s(?:ì|i)?$/iu.test((await question('Installare le dipendenze con npm ci? Richiede il registro npm [s/N]: ')).trim());
      else approved = await new Promise(resolve => { installApproval = resolve; });
      installApproval = null;
      update({ needsInstall: false });
      if (!approved || closing) throw new Error('Dipendenze non installate.');
      update({ step: 'dipendenze', message: 'Installazione delle dipendenze.' });
      await runNpm('ci');
    }
    const nativeStatus = checkNode(true);
    if (!nativeStatus.ok) throw new Error(`${nativeStatus.error}\nEsegui npm ci con Node 24 nella cartella di MediFlow e riprova.`);
    const current = readProductIdentity(ROOT);
    if (current.sourceFingerprint !== identity.sourceFingerprint) throw new Error('I sorgenti sono cambiati. Riapri il lanciatore.');
    if (current.worktreeHash !== 'clean' && choice !== 'sviluppo') throw new Error('Questa cartella contiene modifiche non committate. Scegli Apri per sviluppo oppure usa una copia Git pulita.');
    if (choice === 'mac') {
      const bundleIdentity = readJson(path.join(path.dirname(native), '../Resources/WebRuntime/mediflow-build-identity.json'));
      if (bundleIdentity?.sourceFingerprint !== current.sourceFingerprint) throw new Error('L’app per Mac non corrisponde a questa revisione. Ricostruiscila con la guida nativa oppure scegli Nel browser.');
    } else if (choice !== 'sviluppo') {
      let verified;
      try { verified = verifySourceRuntime(ROOT); } catch { /* Missing or obsolete build requires preparation. */ }
      const decision = buildDecision(current, verified);
      if (options.reuseOnly && decision !== 'reuse') throw new Error('La build ammessa non è disponibile per il riuso.');
      if (decision === 'development-only') throw new Error('Questa cartella contiene modifiche non committate. Scegli Apri per sviluppo oppure usa una copia Git pulita.');
      if (decision === 'build') {
        if (failedBuild === current.sourceFingerprint) throw new Error('La build di questa revisione è già fallita. Controlla i log, correggi la causa e riapri il lanciatore.');
        failedBuild = current.sourceFingerprint;
        update({ step: 'versione', since: Date.now(), message: 'Preparazione di questa versione. Succede una volta sola e richiede qualche minuto.' });
        await runNpm('run build');
        verified = verifySourceRuntime(ROOT);
        if (buildDecision(readProductIdentity(ROOT), verified) !== 'reuse') throw new Error('La build non corrisponde ai sorgenti. Avvio sospeso.');
        failedBuild = null;
      }
    }
    if (closing) return;
    startOptionalOllama();
    update({ step: 'avvio', message: choice === 'agenti' ? 'Avvio dell’accesso per agenti. Collega un client al protocollo del terminale.' : 'Avvio di MediFlow.' });
    let target = null;
    if (choice === 'mac') {
      const owned = run(native, [], false, { ...process.env, MEDIFLOW_NODE_BINARY: process.execPath,
        MEDIFLOW_APP_REVISION: current.revision, MEDIFLOW_APP_BRANCH: current.branch,
        MEDIFLOW_APP_WORKTREE_HASH: current.worktreeHash, MEDIFLOW_APP_SOURCE_FINGERPRINT: current.sourceFingerprint,
        MEDIFLOW_APP_FINGERPRINT: current.sourceFingerprint });
      await new Promise((resolve, reject) => { owned.once('spawn', resolve); owned.once('error', reject); });
    } else {
      const port = Number(process.env.PORT || 3000);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve essere un numero tra 1 e 65535.');
      if (choice !== 'agenti') await requireFreePort(port);
      for (const pair of pairRequests.values()) pair.socket?.destroy();
      pairRequests.clear();
      instance = crypto.randomUUID();
      webSecret = choice === 'web' ? crypto.randomBytes(32).toString('hex') : null;
      const env = { ...process.env, ...(webSecret ? { MEDIFLOW_LOCAL_UI_WEB_SECRET: webSecret, MEDIFLOW_LOCAL_UI_INSTANCE: instance } : {}), HOSTNAME: '127.0.0.1', PORT: String(port),
        ...(choice === 'web' ? { MEDIFLOW_PLUGIN_LOCAL_UI: '1' } : {}),
        ...(choice === 'web' && process.platform === 'win32' ? { MEDIFLOW_WEB_OWNER_GATE: crypto.randomUUID() } : {}),
        MEDIFLOW_APP_REVISION: current.revision, MEDIFLOW_APP_BRANCH: current.branch,
        MEDIFLOW_APP_WORKTREE_HASH: current.worktreeHash, MEDIFLOW_APP_SOURCE_FINGERPRINT: current.sourceFingerprint,
        MEDIFLOW_APP_FINGERPRINT: current.sourceFingerprint };
      const owned = choice === 'sviluppo'
        ? run(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], true, env)
        : run(process.execPath, [path.join(ROOT, 'scripts/source-runtime.mjs'), choice === 'agenti' ? 'headless' : 'web'], true, env);
      if (choice === 'web' && process.platform === 'win32') {
        webJob = await containWindowsWeb(owned, childOwner);
        void webJob.closed.then(() => { if (!closing) void shutdown(); }, error => { void shutdown(error); });
        owned.send({ type: 'mediflow-web-owner-start', nonce: env.MEDIFLOW_WEB_OWNER_GATE });
      }
      owned.on('message', frame => {
        if (!['mediflow-local-ui-pair-approved', 'mediflow-local-ui-pair-revoked'].includes(frame?.type)) return;
        const pair = pairRequests.get(frame.nonce);
        if (!pair || owned !== child) return;
        if (frame.type.endsWith('revoked')) {
          if (pair.socket) pair.socket.destroy();
          else {
            const denied = net.createConnection(pair.returnPath); denied.on('error', () => {});
            denied.once('connect', () => denied.end(JSON.stringify({ type: 'paired', token: '', nonce: pair.nonce,
              dataDir, sourceFingerprint: identity.sourceFingerprint, status: 'denied' }) + '\n'));
          }
          pairRequests.delete(frame.nonce); return;
        }
        if (pair.socket || pair.expiresAt <= Date.now() || pair.instance !== instance) return;
        const socket = net.createConnection(pair.returnPath); pair.socket = socket;
        socket.on('error', () => {});
        socket.once('connect', () => writeFrame(socket, { type: 'paired', token: frame.proof, nonce: pair.nonce, host: pair.host,
          dataDir, sourceFingerprint: identity.sourceFingerprint, status: 'accepted' }));
        frames(socket, message => { void handleNavigation(message, result => writeFrame(socket, result), () => !socket.destroyed, pair); });
        socket.once('close', () => {
          pairRequests.delete(pair.nonce);
          if (owned.connected) owned.send({ type: 'mediflow-local-ui-pair-revoke', nonce: pair.nonce }, () => {});
        });
      });
      const headlessUrl = new Promise((resolve, reject) => {
        if (choice !== 'agenti') { resolve(`http://127.0.0.1:${port}`); return; }
        let buffer = '';
        const timer = setTimeout(() => reject(new Error('L’accesso per agenti non ha comunicato l’indirizzo. Controlla i log.')), 120000);
        owned.once('error', error => { clearTimeout(timer); reject(error); });
        owned.once('exit', () => { clearTimeout(timer); reject(new Error('Accesso per agenti terminato prima dell’avvio.')); });
        owned.stderr.on('data', chunk => {
          buffer = (buffer + chunk).slice(-16384);
          const match = buffer.match(/MEDIFLOW_HEADLESS_WEB_READY (\{[^\r\n]+\})/u);
          if (match) {
            try {
              const url = new URL(JSON.parse(match[1]).url);
              if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Indirizzo non locale.');
              clearTimeout(timer); resolve(url.origin);
            } catch (error) { clearTimeout(timer); reject(error); }
          }
        });
      });
      owned.stderr.on('data', chunk => process.stderr.write(chunk));
      target = await headlessUrl;
      const ready = await waitForRunningInstance(target, current.sourceFingerprint, { timeoutMs: 120000,
        probe: async (url, expected) => {
          if (closing || !owned.pid || owned.exitCode !== null || owned.signalCode !== null) throw new Error('Il processo MediFlow si è arrestato prima di essere pronto.');
          return probeRunningInstance(url, expected);
        } });
      if (choice === 'web' && !await verifyOwnedWeb(target, webSecret)) throw new Error('L’identità Web non è verificata.');
      if (!ready.ok) throw new Error('MediFlow non risponde con l’identità attesa. Controlla il terminale.');
      if (owned.exitCode !== null || owned.signalCode !== null) throw new Error('Il processo MediFlow si è arrestato durante l’avvio.');
      ipcStopChildren.add(owned);
    }
    if (closing) return;
    child.once('exit', () => {
      if (pluginChannel && !closing && !webJob) { void shutdown(); return; }
      if (!closing && attempt === generation) update({ ready: false, busy: false, url: null, step: 'errore', message: 'MediFlow si è arrestato. Controlla i log nel terminale prima di riaprire.' });
    });
    if (!options.reuseOnly && remember && choice !== 'sviluppo') atomicJson(preferencesFile, { schemaVersion: 1, choice });
    else if (!options.reuseOnly && !remember) atomicJson(preferencesFile, { schemaVersion: 1, choice: null });
    update({ busy: false, ready: true, navigationReady: choice === 'web', url: target, step: 'pronto', message: choice === 'mac' ? 'App per Mac avviata. Lascia aperto il terminale.' : `Pronto: ${target}` });
    if (options.noBrowser) log(`Per cambiare scelta o arrestare: ${chooser.url}`);
  };
  const choose = (choice, remember = false) => {
    selectChoice({ explicit: choice, nativeAvailable: !!native, dirty });
    if (state.ready && leases?.external) throw new Error('MediFlow è ancora utilizzato da un altro client.');
    if (!CHOICES.includes(choice) || state.busy || closing) throw new Error('Attendi il completamento dell’avvio prima di cambiare scelta.');
    void start(choice, remember).catch(async error => {
      if (error.code === 'MEDIFLOW_OWNED_STOP_UNCONFIRMED') { await shutdown(error); return; }
      try { await stopChild(); } catch (stopError) { await shutdown(stopError); return; }
      update({ busy: false, ready: false, url: null, needsInstall: false, step: 'errore', message: error.message });
      if (options.choice && options.noBrowser) { process.exitCode = 1; await shutdown(); }
      else if (useTerminal && !closing) {
        try { await chooseTerminal(); } catch (error) { log(error.message); process.exitCode = 1; await shutdown(); }
      }
    });
  };
  const chooseTerminal = async () => {
    const selected = await textualChoice({ nativeAvailable: !!native, dirty, question });
    if (selected === 'stop') { await shutdown(); return; }
    const remember = selected !== 'sviluppo' && /^s(?:ì|i)?$/iu.test((await question('Ricordare questa scelta? [s/N]: ')).trim());
    terminal?.close(); terminal = null;
    choose(selected, remember);
  };
  try {
    chooser = await createChoiceServer({ root: ROOT, state: () => ({ ...state }), choose,
      navigate, cancelNavigation,
      install: () => installApproval?.(true), stop: () => { leases.releaseInitial(); leases.releaseManual(); if (leases.active) return false; if (closing) return shutdown(); }, nativeAvailable: !!native, development: dirty,
      version: identity.version, folder: path.basename(ROOT) });
    leases = await createRuntimeLeases({ directory: archiveOwnership?.directory ?? lockDirectory,
      identity: runtimeProcessIdentity, initialPlugin: pluginChannel, onIdle: shutdown });
    if (closing) { await leases.close(); await chooser.close(); return; }
    const receipt = { ...ownership.receipt, dataDir, choiceUrl: chooser.url, lease: leases.receipt };
    atomicJson(ownership.receiptFile, receipt);
    if (archiveOwnership) atomicJson(archiveOwnership.receiptFile, { ...archiveOwnership.receipt, dataDir, choiceUrl: chooser.url, lease: leases.receipt });
    pairingPoll = setInterval(() => {
      if (!state.ready || !state.navigationReady || closing || !child?.connected) return;
      try {
        for (const request of [requestsDirectory, archiveRequests].filter(Boolean).flatMap(readPairingRequests)) {
          if (request.dataDir !== dataDir || request.sourceFingerprint !== identity.sourceFingerprint || pairRequests.size >= 64) continue;
          const pair = { ...request, instance, socket: null }; pairRequests.set(pair.nonce, pair);
          child.send({ type: 'mediflow-local-ui-pair-offer', request: { nonce: pair.nonce, host: pair.host,
            expiresAt: pair.expiresAt, dataDir, sourceFingerprint: identity.sourceFingerprint, instance } }, () => {});
        }
        for (const [nonce, pair] of pairRequests) if (!pair.socket && pair.expiresAt <= Date.now()) {
          pairRequests.delete(nonce); child.send({ type: 'mediflow-local-ui-pair-revoke', nonce }, () => {});
        }
      } catch { /* An invalid rendezvous never grants navigation. */ }
    }, 100);
    log(`MediFlow ${identity.version}\nCartella: ${ROOT}\nAvvio: ${chooser.url}\nCtrl+C per arrestare.`);
    const preference = readJson(preferencesFile);
    const selected = selectChoice({ explicit: options.choice, remembered: preference?.schemaVersion === 1 ? preference.choice : null,
      forceChoice: options.choose, nativeAvailable: !!native, dirty });
    let text = needsTextMenu();
    if (!options.noBrowser && !text) text = needsTextMenu(process.platform, process.env, openUrl(options.choose ? `${chooser.url}?scegli=1` : chooser.url));
    useTerminal = text || options.noBrowser;
    if (selected) choose(selected, !options.choice && !!preference?.choice);
    else if (useTerminal) await chooseTerminal();
  } catch (error) { await shutdown(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { log(error.message); process.exitCode = 1; });
}
