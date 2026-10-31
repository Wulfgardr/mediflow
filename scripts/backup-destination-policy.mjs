import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const SYNC_DIRECTORY_NAMES = Object.freeze([
  'Mobile Documents', 'CloudStorage', 'Dropbox', 'OneDrive', 'Google Drive',
  'GoogleDrive', 'iCloud Drive', 'iCloudDrive', 'com~apple~CloudDocs',
  'Nextcloud', 'ownCloud', 'pCloud', 'Box', 'Box Sync', 'MEGA', 'SynologyDrive',
]);
export const LINUX_SINGLE_DEVICE_FILESYSTEMS = Object.freeze(['ext2', 'ext3', 'ext4', 'xfs', 'ntfs', 'ntfs3', 'vfat', 'exfat']);
export const MOUNT_ROOTS = Object.freeze(['/Volumes', '/mnt', '/media', '/run/media']);

export class BackupDestinationError extends Error {
  constructor(userMessage) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

function foldPath(value) {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

export function isSynchronizedBackupPath(value, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const normalized = foldPath(api.resolve(value).replaceAll('\\', '/'));
  const home = foldPath(api.resolve(homeDir).replaceAll('\\', '/'));
  if (['documents', 'desktop'].some(name => normalized === `${home}/${name}` || normalized.startsWith(`${home}/${name}/`))) return true;
  return normalized.split('/').some(component => SYNC_DIRECTORY_NAMES.some(name => {
    const lower = foldPath(name);
    return component === lower || component.startsWith(`${lower} - `) || component.startsWith(`${lower}-`);
  }));
}

export function resolveBackupDestination(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.trim() !== value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new BackupDestinationError('Scegli una cartella assoluta esistente sul computer host.');
  }
  const realPath = fs.realpathSync(value);
  if (isSynchronizedBackupPath(value) || isSynchronizedBackupPath(realPath) || isSynchronizedBackupPath(realPath, { homeDir: fs.realpathSync(os.homedir()) })) {
    throw new BackupDestinationError('La destinazione dei backup è in una cartella sincronizzata. Scegli una cartella locale su un volume cifrato.');
  }
  if (!fs.statSync(realPath).isDirectory() || realPath.startsWith('\\\\')) throw new BackupDestinationError('Scegli una cartella locale esistente.');
  for (const candidate of [path.resolve(value), realPath]) {
    for (const root of MOUNT_ROOTS) {
      if (!candidate.startsWith(`${root}/`)) continue;
      const rootDevice = fs.statSync(root).dev;
      const parts = candidate.slice(root.length + 1).split('/');
      const volume = `${root}/${parts[0]}`;
      if (root === '/Volumes' && (fs.lstatSync(volume).isSymbolicLink() || fs.statSync(volume).dev === rootDevice)) throw new BackupDestinationError('Il volume della destinazione non risulta montato. Nessun backup scritto.');
      const mounted = parts.some((_, index) => fs.statSync(`${root}/${parts.slice(0, index + 1).join('/')}`).dev !== rootDevice);
      if (!mounted) throw new BackupDestinationError('Il volume della destinazione non risulta montato. Nessun backup scritto.');
    }
  }
  return realPath;
}

function command(file, args, input) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, ...(input ? { input } : {}) });
  if (result.error || result.status !== 0 || result.signal) throw new Error('Volume non verificabile');
  return result.stdout.trim();
}

export function probeBackupVolume(destination, { platform = process.platform, run = command } = {}) {
  try {
    if (platform === 'darwin') {
      const device = run('/bin/df', ['-P', destination]).split('\n').at(-1)?.trim().split(/\s+/u)[0];
      if (!device?.startsWith('/dev/')) return 'unverified';
      const plist = run('/usr/sbin/diskutil', ['info', '-plist', device]);
      const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], plist));
      if (info.FileVault === true || info.APFSEncrypted === true || info.Encrypted === true || info.Encryption === true) return 'verified';
      if (info.FileVault === false || info.APFSEncrypted === false || info.Encrypted === false || info.Encryption === false) return 'unencrypted';
      return 'unverified';
    }
    if (platform === 'win32') {
      const drive = path.win32.parse(destination).root.slice(0, 2);
      if (!/^[a-z]:$/iu.test(drive)) return 'unverified';
      const info = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Get-BitLockerVolume -MountPoint '${drive}' | Select-Object VolumeStatus,ProtectionStatus | ConvertTo-Json -Compress`]));
      if (info.ProtectionStatus === 0 || [0, 2, 3, 4, 5].includes(info.VolumeStatus)) return 'unencrypted';
      return info.VolumeStatus === 1 && info.ProtectionStatus === 1 ? 'verified' : 'unverified';
    }
    if (platform === 'linux') {
      const filesystem = JSON.parse(run('findmnt', ['--json', '--target', destination, '--output', 'SOURCE,FSTYPE'])).filesystems?.[0];
      const mount = filesystem?.source;
      if (typeof mount !== 'string' || !mount.startsWith('/dev/') || !LINUX_SINGLE_DEVICE_FILESYSTEMS.includes(filesystem.fstype)) return 'unverified';
      const devices = JSON.parse(run('lsblk', ['--json', '--inverse', '--output', 'NAME,TYPE', mount.split('[')[0]])).blockdevices;
      const encrypted = nodes => Array.isArray(nodes) && nodes.length > 0 && nodes.every(node => node.type === 'crypt' || encrypted(node.children));
      if (encrypted(devices)) return 'verified';
      const clear = nodes => Array.isArray(nodes) && nodes.length > 0 && nodes.every(node => node.type === 'disk' || (['part', 'lvm', 'raid0', 'raid1', 'raid5', 'raid6', 'raid10', 'md', 'mpath'].includes(node.type) && clear(node.children)));
      return clear(devices) ? 'unencrypted' : 'unverified';
    }
  } catch { return 'unverified'; }
  return 'unverified';
}

export function backupDestinationIdentity(destination) {
  return `${destination}:${fs.statSync(destination).dev}`;
}

export function validateBackupDestination(value, acknowledged = false, acknowledgedIdentity) {
  let destination;
  try { destination = resolveBackupDestination(value); }
  catch (error) {
    if (error instanceof BackupDestinationError) throw error;
    throw new BackupDestinationError('La cartella di destinazione non è disponibile. Scegli una cartella esistente su un volume montato.');
  }
  const directoryIdentity = fs.statSync(destination);
  const protection = probeBackupVolume(destination);
  if (protection === 'unencrypted') throw new BackupDestinationError('Il volume della destinazione non risulta cifrato. Attiva la cifratura prima di programmare il backup.');
  if (protection !== 'verified' && (acknowledged !== true || (acknowledgedIdentity !== undefined && acknowledgedIdentity !== backupDestinationIdentity(destination)))) throw new BackupDestinationError('Cifratura del volume non verificabile da MediFlow. È richiesta la conferma esplicita del requisito del volume cifrato.');
  return { destination, protection, directoryIdentity };
}
