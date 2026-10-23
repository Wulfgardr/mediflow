import { createLocalOperationProtocol } from '../packages/mcp/src/local-operation-server.ts';
import { createLocalOperationIpcClient } from '../packages/mcp/src/local-operation-client.ts';

const client = createLocalOperationIpcClient();
const protocol = createLocalOperationProtocol(client);
let buffered = Buffer.alloc(0), queued = 0, terminal = false, chain = Promise.resolve();
const fixedError = '{"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"MediFlow unavailable."}}\n';
function close() {
    if (terminal) return;
    terminal = true; protocol.close(); buffered = Buffer.alloc(0);
    if (process.connected) process.disconnect();
    process.stdin.destroy();
}
process.stdin.on('data', chunk => {
    if (terminal) return;
    buffered = Buffer.concat([buffered, chunk]);
    while (!terminal) {
        const end = buffered.indexOf(10);
        if (end < 0) break;
        if (end > 4096 || ++queued > 64) { process.stdout.write(fixedError); close(); return; }
        const line = buffered.subarray(0, end).toString('utf8');
        buffered = buffered.subarray(end + 1);
        chain = chain.then(async () => {
            if (terminal) return;
            const response = await protocol.receive(line);
            if (response !== null && !terminal) process.stdout.write(`${response}\n`);
        }).catch(() => { process.stderr.write('MediFlow unavailable.\n'); close(); });
    }
    if (buffered.length > 4096) { process.stdout.write(fixedError); close(); }
});
process.stdin.once('end', () => { void chain.finally(close); });
process.stdin.on('error', close);
process.stdout.on('error', close);
process.once('SIGTERM', close); process.once('SIGINT', close); process.once('disconnect', close);
process.on('uncaughtException', () => { process.stderr.write('MediFlow unavailable.\n'); close(); process.exitCode = 1; });
process.on('unhandledRejection', () => { process.stderr.write('MediFlow unavailable.\n'); close(); process.exitCode = 1; });
