import { agentCommandFailure, executeAgentCommand, parseAgentCommand } from './commands';
import { AgentClientError } from './visit-client';

async function fiscalCodeFromStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => process.stdin.destroy(new AgentClientError('AGENT_INPUT_INVALID')), 10000);
    try {
        for await (const chunk of process.stdin) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > 64) throw new AgentClientError('AGENT_INPUT_INVALID');
            chunks.push(bytes);
        }
        const value = Buffer.concat(chunks).toString('utf8').trim().toUpperCase();
        if (!/^[A-Z0-9]{16}$/u.test(value)) throw new AgentClientError('AGENT_INPUT_INVALID');
        return value;
    } finally { clearTimeout(timeout); }
}

async function main() {
    try {
        const { command, directory } = parseAgentCommand(process.argv.slice(2));
        if (command.command === 'deposita' && command.fiscalCode === '-') command.fiscalCode = await fiscalCodeFromStdin();
        process.stdout.write(JSON.stringify(await executeAgentCommand(command, directory)) + '\n');
    } catch (error) {
        process.stderr.write(JSON.stringify(agentCommandFailure(error)) + '\n');
        process.exitCode = 1;
    }
}
void main();
