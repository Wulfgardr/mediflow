/* @Codex: process-local test doubles using the project's synchronous loader.
 * Never imported by production. No source rewrite or runtime admission switch. */
import * as nodeModule from 'node:module';
import { randomUUID } from 'node:crypto';
import { after } from 'node:test';

// The repository's Node typings predate the Node 24 synchronous hook API.
// Keep this test-only declaration aligned with the canonical loader's methods.
type HookContext = { parentURL?: string };
type NextHook = (value: string, context: HookContext) => unknown;
const { registerHooks } = nodeModule as unknown as {
    registerHooks(hooks: {
        resolve(value: string, context: HookContext, next: NextHook): unknown;
        load(value: string, context: HookContext, next: NextHook): unknown;
    }): { deregister(): void };
};

export function mockOrdinaryModule(parent: string, specifier: string, options: { namedExports: object }): void {
    const target = new URL(specifier + '.ts', parent).href;
    const key = 'mediflow-test-only-' + randomUUID();
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[key] = options.namedExports;
    const url = 'mediflow-test-double:' + key;
    const hook = registerHooks({
        resolve(name, context, nextResolve) {
            if (context.parentURL && name.startsWith('.')) {
                const candidate = new URL(name, context.parentURL).href;
                if (candidate === target || candidate + '.ts' === target) return { url, shortCircuit: true };
            }
            return nextResolve(name, context);
        },
        load(candidate, context, nextLoad) {
            if (candidate === url) return { format: 'commonjs', shortCircuit: true,
                source: 'module.exports = globalThis[' + JSON.stringify(key) + '];' };
            return nextLoad(candidate, context);
        },
    });
    after(() => { hook.deregister(); delete globals[key]; });
}
