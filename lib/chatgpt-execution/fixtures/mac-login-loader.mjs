/* @Codex — Verification ONLY: built-in TypeScript transform + extensionless resolution.
 * No authority, native API, missing application module or runtime result stub.
 * Use --import <this-file> with node --test; production never imports it. */
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const shim = 'data:text/javascript,export{}';
registerHooks({
    resolve(specifier, context, next) {
        if (specifier === 'server-only') return { url: shim, shortCircuit: true };
        try { return next(specifier, context); }
        catch (error) {
            if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[mc]?[jt]sx?$/u.test(specifier)) {
                for (const ext of ['.ts', '.mjs', '.js']) {
                    const url = new URL(specifier + ext, context.parentURL);
                    if (existsSync(url)) return { url: url.href, shortCircuit: true };
                }
            }
            throw error;
        }
    },
    load(url, context, next) {
        if (url === shim) return { format: 'module', source: 'export {};', shortCircuit: true };
        if (url.startsWith('file:') && url.endsWith('.ts')) return {
            format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }), shortCircuit: true,
        };
        return next(url, context);
    },
});
