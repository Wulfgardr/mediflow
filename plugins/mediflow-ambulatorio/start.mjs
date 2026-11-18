import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultHome = path.join(os.homedir(), '.mediflow-ambulatorio');
const home = process.env.MEDIFLOW_AMBULATORIO_HOME ?? defaultHome;
const configPath = path.join(home, 'config.json');
const plugin = fileURLToPath(new URL('.', import.meta.url));

try {
    if (process.versions.node.split('.')[0] !== '24' || process.platform === 'win32') throw Error();
    const settingUp = process.argv[2] === 'configura';
    const repository = settingUp ? path.resolve(plugin, '../..') : readConfig().repository;
    if (!path.isAbsolute(repository)) throw Error();
    const fromRepository = relative => pathToFileURL(path.join(repository, relative)).href;
    await import(fromRepository('scripts/register-strip-types-loader.mjs'));
    const { configureAmbulatorio, serveAmbulatorio } = await import(fromRepository('packages/agent-client/src/ambulatorio.ts'));
    if (settingUp) {
        const [origin, downloads = path.join(os.homedir(), 'Downloads'), ...physicianCodes] = process.argv.slice(3);
        configureAmbulatorio(home, configPath, { repository, origin, downloads, physicianCodes });
        const launchPath = path.join(home, 'launcher.mjs');
        const temporary = path.join(home, 'launcher-' + randomUUID() + '.tmp');
        fs.writeFileSync(temporary, 'await import(' + JSON.stringify(import.meta.url) + ');\n', { flag: 'wx', mode: 0o600 });
        try { fs.renameSync(temporary, launchPath); }
        finally { fs.rmSync(temporary, { force: true }); }
        process.stdout.write('MediFlow Ambulatorio configurato.\n');
    } else {
        serveAmbulatorio(home, readConfig(), plugin);
    }
} catch {
    process.stderr.write('MEDIFLOW_AMBULATORIO_SETUP_REQUIRED: verifica configurazione, checkout e Node 24.\n');
    process.exitCode = 1;
}

function readConfig() {
    const rootStat = fs.lstatSync(home);
    if (!path.isAbsolute(home) || !rootStat.isDirectory() || rootStat.uid !== process.getuid() || (rootStat.mode & 0o7777) !== 0o700) throw Error();
    const fd = fs.openSync(configPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600 || stat.size > 8192) throw Error();
        return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
}
