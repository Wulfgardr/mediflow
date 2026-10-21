import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function isNetworkDenial(code, host, platform = process.platform) {
  return ['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT'].includes(code)
    || (platform === 'linux' && host === '::1' && code === 'EADDRNOTAVAIL');
}
async function validateOffline(config) {
  const evidence = { state: 'PROCESS_NETWORK_DENIED', validatorStarted: false, probes: [] };
  for (const host of ['1.1.1.1', '::1']) {
    const code = await new Promise(resolve => {
      const socket = net.connect({ host, port: 443 });
      socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT'); });
      socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
      socket.once('error', error => resolve(error.code));
    });
    evidence.probes.push({ host, code });
    if (!isNetworkDenial(code, host)) {
      evidence.state = 'NETWORK_DENIAL_NOT_PROVEN';
      writeFileSync(config.networkEvidence, JSON.stringify(evidence, null, 2));
      throw new Error(`NETWORK_DENIAL_NOT_PROVEN:${host}:${code}`);
    }
  }
  evidence.validatorStarted = true;
  writeFileSync(config.networkEvidence, JSON.stringify(evidence, null, 2));
  const result = spawnSync(config.javaExecutable, config.javaArgs, { env: config.environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 2);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateOffline(JSON.parse(readFileSync(process.argv[2], 'utf8')));
}
