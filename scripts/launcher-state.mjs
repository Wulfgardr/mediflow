import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Cartella di configurazione del lanciatore non valida.');
  }
  // On Windows the folder lives in the user profile (%APPDATA%), whose inherited ACL is already user-only.
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function regularJson(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (process.getuid && stat.uid !== process.getuid())) return null;
    const bytes = fs.readFileSync(file);
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch { return null; }
}

function moveLauncherFile(source, target, bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (fs.existsSync(target)) target = `${target}.migrated-${digest}`;
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if (error.code !== 'EEXIST' || !regularJson(target)?.bytes.equals(bytes)) throw error;
    }
    fs.unlinkSync(source);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function migrateLegacyState(dataDir, directory, key, root) {
  const legacyLock = path.join(dataDir, `.mediflow-launcher-${key}`);
  if (fs.existsSync(legacyLock)) {
    const stat = fs.lstatSync(legacyLock);
    if (stat.isDirectory() && !stat.isSymbolicLink()
      && (!process.getuid || stat.uid === process.getuid())
      && fs.readdirSync(legacyLock).length === 1) {
      const file = path.join(legacyLock, 'instance.json');
      const record = regularJson(file);
      const receipt = record?.value;
      if (receipt && Object.keys(receipt).every(name => ['pid', 'checkoutPath', 'choiceUrl'].includes(name))
        && receipt.checkoutPath === root && Number.isSafeInteger(receipt.pid) && receipt.pid > 0
        && (receipt.choiceUrl === undefined || (typeof receipt.choiceUrl === 'string'
          && /^http:\/\/127\.0\.0\.1:\d+\//u.test(receipt.choiceUrl)))) {
        let alive = true;
        try { process.kill(receipt.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
        if (alive) throw new Error('Un avvio precedente è ancora in corso. Arrestalo dal suo terminale e riapri MediFlow.');
        moveLauncherFile(file, path.join(directory, 'legacy-instance.json'), record.bytes);
        fs.rmdirSync(legacyLock);
      }
    }
  }
  const file = path.join(dataDir, 'launcher-preferences.json');
  const record = regularJson(file);
  const preference = record?.value;
  if (preference && Object.keys(preference).length === 2 && preference.schemaVersion === 1
    && Object.hasOwn(preference, 'choice')
    && [null, 'web', 'mac', 'agenti', 'sviluppo'].includes(preference.choice)) {
    moveLauncherFile(file, path.join(directory, 'launcher-preferences.json'), record.bytes);
  }
}

export function launcherConfigDirectory({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const config = platform === 'darwin' ? paths.join(home, 'Library/Application Support/MediFlow/launcher')
    : platform === 'win32' ? paths.join(env.APPDATA || paths.join(home, 'AppData/Roaming'), 'MediFlow/launcher')
      : paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'mediflow/launcher');
  if (!paths.isAbsolute(config)) throw new Error('La cartella di configurazione deve avere un percorso assoluto.');
  return config;
}

export function prepareLauncherState(root, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const config = launcherConfigDirectory({ env, platform, home });
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const defaultDataDir = platform === 'darwin'
    ? paths.join(home, 'Library/Application Support/MediFlow') : paths.join(home, '.mediflow');
  const dataDir = env.MEDIFLOW_DATA_DIR || defaultDataDir;
  const contains = (parent, child) => {
    const relative = paths.relative(paths.resolve(parent), paths.resolve(child));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
  };
  const canonicalMacRoot = platform === 'darwin' && paths.resolve(dataDir) === paths.resolve(defaultDataDir);
  if (contains(config, dataDir) || (contains(dataDir, config) && !canonicalMacRoot)) {
    throw new Error('La cartella dati scelta si sovrappone alla configurazione del lanciatore. Scegli una cartella dati separata.');
  }
  const key = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16);
  privateDirectory(config);
  const directory = paths.join(config, key);
  privateDirectory(directory);
  // Legacy discovery never creates the selected archive directory.
  migrateLegacyState(dataDir, directory, key, path.resolve(root));
  return {
    preferencesFile: paths.join(directory, 'launcher-preferences.json'),
    lockDirectory: paths.join(directory, `.mediflow-launcher-${key}`),
  };
}

export function localUiArchiveLock(dataDir) {
  const directory = path.join(launcherConfigDirectory(),
    `local-ui-${crypto.createHash('sha256').update(dataDir).digest('hex')}`);
  privateDirectory(directory);
  return path.join(directory, 'launcher');
}
