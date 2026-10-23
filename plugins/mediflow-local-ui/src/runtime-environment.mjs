import path from 'node:path';

const inheritedNames = [
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
  'LC_COLLATE', 'LC_TIME', 'LC_NUMERIC', 'LC_MONETARY', 'LC_PAPER', 'LC_NAME',
  'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION', 'TZ',
  'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
  'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'MEDIFLOW_MAC_CONFIG',
];

export function ordinaryLauncherEnvironment(dataDir, inherited = process.env) {
  const env = Object.fromEntries(inheritedNames.filter(name => inherited[name] !== undefined)
    .map(name => [name, inherited[name]]));
  return { ...env, PATH: [path.dirname(process.execPath), inherited.PATH].filter(Boolean).join(path.delimiter),
    MEDIFLOW_DATA_DIR: dataDir };
}
