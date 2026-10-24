import { withArchiveRequestContext } from '@/lib/security/archive-request-context';
import { readLocalUiPairing, decideLocalUiPairing } from '@/lib/security/plugin-local-ui-pairing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withArchiveRequestContext(readLocalUiPairing);
export const POST = withArchiveRequestContext(decideLocalUiPairing);
