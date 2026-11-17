import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { createAgentIncomingReader } from '@/lib/security/agent-incoming-reader';
import { readAgentCassettes } from '@/lib/agent-cassette-store';
import { openDbServer } from '@/lib/db-server';

export const runtime = 'nodejs';
export const GET = createAgentIncomingReader({ session: readAuthenticatedWebSession, cassettes: () => readAgentCassettes(openDbServer()) });
