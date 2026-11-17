import { agentCommandFailure, executeAgentCommand, parseAgentCommand } from './commands';

async function main() {
    try {
        const { command, directory } = parseAgentCommand(process.argv.slice(2));
        process.stdout.write(JSON.stringify(await executeAgentCommand(command, directory)) + '\n');
    } catch (error) {
        process.stderr.write(JSON.stringify(agentCommandFailure(error)) + '\n');
        process.exitCode = 1;
    }
}
void main();
