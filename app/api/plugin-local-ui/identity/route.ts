import { isPluginLocalUiRuntime } from '@/lib/security/plugin-local-ui-runtime';
import { webIdentityProof } from '@/scripts/local-ui-web-identity.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isPluginLocalUiRuntime() || request.headers.get('content-length') !== '64') return new Response(null, { status: 404 });
  const proof = webIdentityProof(process.env.MEDIFLOW_LOCAL_UI_WEB_SECRET, await request.text());
  return new Response(proof, { status: proof ? 200 : 404, headers: {
    'Content-Length': proof ? '64' : '0', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain',
  } });
}
