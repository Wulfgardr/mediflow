/* @Codex */
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { apiInternalError } from '@/lib/api-error-response';
import { readWorkProfile, updateWorkProfile } from '@/lib/work-profile-service';
import { WorkProfileError } from '@/lib/work-profile';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
    if (error instanceof WorkProfileError) {
        return NextResponse.json({ code: error.code }, {
            status: error.code === 'input_invalid' ? 400 : 409,
            headers: { 'Cache-Control': 'no-store' },
        });
    }
    return apiInternalError('onboarding/work-profile', error);
}

export async function GET() {
    if (!await requireSession()) return unauthorizedResponse();
    try {
        return NextResponse.json(readWorkProfile(), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
    if (!await requireSession()) return unauthorizedResponse();
    let input: unknown;
    try { input = await request.json(); }
    catch { return failure(new WorkProfileError('input_invalid')); }
    try {
        return NextResponse.json(updateWorkProfile(input), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return failure(error); }
}
