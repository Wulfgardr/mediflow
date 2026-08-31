/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../app/api/auth/reset/route.ts', import.meta.url), 'utf8');

test('admin reset fences Web and native/system owners before DB and commits both after DB', () => {
    const prepareWeb = source.indexOf('webCapability = prepareAdminReset(session)');
    const prepareNative = source.indexOf('nativeCapability = prepareNativeSystemAdminReset()');
    const databaseMutation = source.indexOf('await dbServer.delete(users)');
    const commitWeb = source.indexOf('commitAdminReset(webCapability)');
    const commitNative = source.indexOf('commitNativeSystemAdminReset(nativeCapability)');
    const cookieDeletion = source.indexOf("response.cookies.set(SESSION_COOKIE_NAME, '', {");

    assert.ok(prepareWeb >= 0);
    assert.ok(prepareNative > prepareWeb);
    assert.ok(databaseMutation > prepareNative);
    assert.ok(commitWeb > databaseMutation);
    assert.ok(commitNative > commitWeb);
    assert.ok(cookieDeletion > commitNative);
});

test('admin reset aborts both capabilities on DB failure and does not use mixed legacy APIs', () => {
    assert.match(source, /catch \(error\) \{\s*abortPreparedReset\(webCapability, nativeCapability\);/u);
    assert.match(source, /function abortPreparedReset[\s\S]*abortAdminReset\(webCapability\)[\s\S]*abortNativeSystemAdminReset\(nativeCapability\)/u);
    assert.doesNotMatch(source, /\bclearAllSessions\b|\binvalidateSessionsForUser\b/u);
    assert.doesNotMatch(source, /cookieStore\.delete|cookies\(\)/u);
    assert.match(source, /maxAge: 0/u);
});
