import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSessionOrLocalToken } from '@/lib/security/server-auth';

/**
 * POST /api/ocr/extract
 *
 * Legacy OCR execution route retirement boundary.
 */
export async function POST(request: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) {
        return NextResponse.json({
            error: 'Unauthorized',
        }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }

    return NextResponse.json({
        error: 'OCR extraction endpoint retired',
        code: 'OCR_EXTRACTION_RETIRED',
    }, { status: 410, headers: { 'cache-control': 'no-store' } });
}

/**
 * GET /api/ocr/extract
 *
 * Legacy OCR diagnostic route retirement boundary.
 */
export async function GET(request: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) {
        return NextResponse.json({
            error: 'Unauthorized',
        }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }

    return NextResponse.json({
        error: 'OCR extraction endpoint retired',
        code: 'OCR_EXTRACTION_RETIRED',
    }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
