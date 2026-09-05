/* @Codex */
import { admitNativeBootstrap } from '@/lib/security/native-bootstrap-admission';
import { nativeLoginDeniedResponse, nativeLoginHttp } from '@/lib/security/native-login-http';

/** Native pairing admission precedes the only body fields this route accepts. */
/* @Codex */
export async function POST(request: Request) {
    let admission: object | null = null;
    try {
        admission = await admitNativeBootstrap({ request });
        if (!admission) return nativeLoginDeniedResponse();
        const body = await request.json();
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        return nativeLoginHttp(request, admission, { username, password });
    } catch {
        return admission ? nativeLoginHttp(request, admission, Object.create(null)) : nativeLoginDeniedResponse();
    }
}
