import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { PM2Manager } from '@/lib/pm2-manager';
/* @Codex */
import { requireSession, requireSessionOrLocalToken, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { apiInternalError } from '@/lib/api-error-response';

/* @Codex */
// MLX (mlx_lm) and the PM2-managed inference server run only on macOS Apple Silicon.
// On Windows/Linux return a structured 501 instead of letting PM2 throw a cryptic 500.
const MLX_SUPPORTED = process.platform === 'darwin';

/* @Codex */
function mlxUnsupportedResponse() {
    return NextResponse.json(
        {
            error: 'MLX non disponibile su questa piattaforma.',
            detail: `Il runtime MLX/PM2 e supportato solo su macOS Apple Silicon (rilevato ${process.platform}/${process.arch}). Su Windows e Linux usa Ollama come runtime AI locale.`,
            supported: false,
        },
        { status: 501 },
    );
}

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();
    /* @Codex */
    if (!MLX_SUPPORTED) return mlxUnsupportedResponse();

    try {
        const status = await PM2Manager.withConnection(() => PM2Manager.getStatus());
        return NextResponse.json(status);
    } catch (error) {
        return apiInternalError('GET /api/system/mlx', error);
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    /* @Codex */
    if (!MLX_SUPPORTED) return mlxUnsupportedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        await PM2Manager.withConnection(() => PM2Manager.start());
        return NextResponse.json({ success: true, message: "Avvio PM2 richiesto; verifica lo stato locale." });
    } catch (error) {
        return apiInternalError('POST /api/system/mlx', error);
    }
}

export async function DELETE(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    /* @Codex */
    if (!MLX_SUPPORTED) return mlxUnsupportedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        await PM2Manager.withConnection(() => PM2Manager.stop());
        return NextResponse.json({ success: true, message: "Stopped" });
    } catch (error) {
        return apiInternalError('DELETE /api/system/mlx', error);
    }
}
