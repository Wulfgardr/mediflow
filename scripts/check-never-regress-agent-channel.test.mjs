import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateAgentRouteSource } from './check-never-regress.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const visits = 'app/api/agent/v1/visits/route.ts';
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const guarded = `
import { openDbServer } from '@/lib/db-server';
import { AgentCassetteDenied, createAgentCassetteStore } from '@/lib/agent-cassette-store';
import { agentChannelFailure, withAuthenticatedAgentTransaction } from '@/lib/security/agent-channel';

export async function POST(request: Request): Promise<Response> {
    try {
        const database = openDbServer(), store = createAgentCassetteStore(database);
        return withAuthenticatedAgentTransaction(database, request, 'visita.nota', principal => Response.json(store.add(principal, 'id', 1, null)));
    } catch (error) { return error instanceof AgentCassetteDenied ? new Response(null) : agentChannelFailure(error); }
}
`;

test('every current agent route passes the channel rule', () => {
    for (const relativePath of ['confirmation', 'context', 'mandate', 'pairings', 'visits'].map((name) => `app/api/agent/v1/${name}/route.ts`)) {
        assert.deepEqual(validateAgentRouteSource(read(relativePath), relativePath), [], relativePath);
    }
    assert.deepEqual(validateAgentRouteSource(guarded, visits), []);
});

test('an operation outside the egress-checked channel is a finding', () => {
    const direct = guarded.replace("return withAuthenticatedAgentTransaction(database, request, 'visita.nota', principal => Response.json(store.add(principal, 'id', 1, null)));",
        'return Response.json(store.add(principal, \'id\', 1, null));');
    assert.match(validateAgentRouteSource(direct, visits).join('\n'), /store must run inside the consume callback/u);
});

test('an operation under a null operation channel call is a finding outside the context read', () => {
    const nullOperation = guarded.replace("'visita.nota'", 'null');
    const issues = validateAgentRouteSource(nullOperation, visits).join('\n');
    assert.match(issues, /without an operation is reserved/u);
    assert.match(issues, /store must run inside the consume callback/u);
});

test('an aliased or locally defined guard does not count as the channel', () => {
    const aliased = guarded.replace('agentChannelFailure, withAuthenticatedAgentTransaction }', 'agentChannelFailure, withAuthenticatedAgentTransaction as channel }')
        .replace('return withAuthenticatedAgentTransaction(', 'return channel(');
    assert.match(validateAgentRouteSource(aliased, visits).join('\n'), /imported unaliased/u);
    const local = guarded.replace('agentChannelFailure, withAuthenticatedAgentTransaction }', 'agentChannelFailure }')
        + '\nfunction withAuthenticatedAgentTransaction(...args: unknown[]) { return args; }\n';
    assert.match(validateAgentRouteSource(local, visits).join('\n'), /store must run inside the consume callback/u);
});

test('a direct operation import and an unclassified module are findings', () => {
    const direct = guarded.replace("import { openDbServer } from '@/lib/db-server';",
        "import { openDbServer } from '@/lib/db-server';\nimport { startVisitConfirmation } from '@/lib/agent-visit-confirmation';")
        .replace('    try {\n', '    try {\n        startVisitConfirmation(null, \'id\');\n');
    assert.match(validateAgentRouteSource(direct, visits).join('\n'), /startVisitConfirmation must run inside/u);
    const unclassified = guarded.replace("import { openDbServer } from '@/lib/db-server';",
        "import { openDbServer } from '@/lib/db-server';\nimport { applyAgentVisit } from '@/lib/agent-visit-application';");
    assert.match(validateAgentRouteSource(unclassified, visits).join('\n'), /agent-visit-application must be classified/u);
});
