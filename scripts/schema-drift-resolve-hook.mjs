/* @Codex */
// WUL-268 (STREAM A): resolve hook for the schema drift check worker.
//
// lib/db-server.ts and lib/schema.ts use the "@/*" TypeScript path alias and
// import "server-only". Neither resolves under a plain node ESM run. This hook
// maps "@/<x>" to "<projectRoot>/<x>" (letting the strip-types loader append the
// .ts extension) and stubs "server-only" with an empty module, so the worker can
// import the REAL modules and run the actual applySchemaGuards() side effect.
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.env.MEDIFLOW_SCHEMA_DRIFT_ROOT;
const SERVER_ONLY_STUB = 'data:text/javascript,export%20default%20{};';

// The "@/" aliased modules are extensionless TS files (e.g. "@/lib/db-server"
// -> "lib/db-server.ts"). Resolve the concrete on-disk path here so the
// strip-types loader receives a real .ts URL to transpile.
function resolveAliasedPath(base) {
    const candidates = [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        path.join(base, 'index.ts'),
        base,
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return base;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'server-only') {
            return { url: SERVER_ONLY_STUB, shortCircuit: true };
        }
        if (specifier.startsWith('@/')) {
            if (!ROOT_DIR) {
                throw new Error('MEDIFLOW_SCHEMA_DRIFT_ROOT is not set');
            }
            const target = resolveAliasedPath(path.join(ROOT_DIR, specifier.slice(2)));
            // Short-circuit rather than delegating to nextResolve: db-server.ts
            // imports "@/lib/security/audit-db" without a "./" prefix or extension, so the
            // strip-types loader transpiles it to CommonJS and emits a require().
            // Handing a "file://.../audit-db.ts" URL back to the default CJS
            // resolver via nextResolve makes it throw MODULE_NOT_FOUND (it will
            // not resolve a .ts file URL). Short-circuiting hands the already
            // resolved .ts URL straight to the strip-types load hook to transpile.
            return { url: pathToFileURL(target).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        // The strip-types loader only special-cases its OWN server-only stub URL.
        // This hook returns a DIFFERENT stub URL above, so it must also serve the
        // stub source; otherwise the default loader tries to readFileSync() the
        // data: URI and fails with ENOENT.
        if (url === SERVER_ONLY_STUB) {
            return { format: 'commonjs', shortCircuit: true, source: 'module.exports = {};\n' };
        }
        return nextLoad(url, context);
    },
});
