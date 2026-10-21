import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const evidence = [];
for (const host of ['1.1.1.1', '::1']) {
  const code = await new Promise(resolve => {
    const socket = net.connect({ host, port: 443 });
    socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT'); });
    socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
    socket.once('error', error => resolve(error.code));
  });
  if (!['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT'].includes(code)) {
    throw new Error(`NETWORK_DENIAL_NOT_PROVEN:${host}:${code}`);
  }
  evidence.push({ host, code });
}
writeFileSync(config.networkEvidence, JSON.stringify({ state: 'PROCESS_NETWORK_DENIED', probes: evidence }, null, 2));
const result = spawnSync(config.javaExecutable, config.javaArgs, { env: config.environment, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 2);
