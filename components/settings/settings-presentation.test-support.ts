/* @Codex WUL-684: isolated JSX contract harness. Not React DOM, a browser, or a
   lifecycle/focus simulation. Callbacks execute their real component code against
   explicit test doubles; effects never run unless the test invokes one. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export type TestNode = { type: string | symbol | ((props: Record<string, unknown>) => unknown); props: Record<string, unknown> };
export function element(type: TestNode['type'], props: Record<string, unknown>): TestNode { return { type, props }; }
export function flatten(tree: unknown): TestNode[] {
    if (Array.isArray(tree)) return tree.flatMap(flatten);
    if (!tree || typeof tree !== 'object' || !('type' in tree)) return [];
    const node = tree as TestNode;
    return [node, ...flatten(node.props.children)];
}
export function text(tree: unknown, includeDiagnostics = true): string {
    if (Array.isArray(tree)) return tree.map(child => text(child, includeDiagnostics)).join(' ');
    if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
    if (typeof tree !== 'object') return String(tree);
    const node = tree as TestNode;
    if (!includeDiagnostics && node.type === 'details') {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        return children.filter((child: unknown) => typeof child === 'object' && child !== null && (child as TestNode).type === 'summary')
            .map((child: unknown) => text(child, false)).join(' ');
    }
    return text(node.props.children, includeDiagnostics);
}
export function find(tree: unknown, predicate: (node: TestNode) => boolean): TestNode {
    const node = flatten(tree).find(predicate);
    if (!node) throw new Error('Expected JSX node not found');
    return node;
}
export const css = new Proxy({}, { get: (_target, name) => `fixture-${String(name)}` });
export const frameworkDoubles = {
    'next/link': { default: (props: Record<string, unknown>) => element('a', props) },
    'next/image': { default: (props: Record<string, unknown>) => element('img', props) },
    '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
    './settings-ui': { SETTINGS_CARD_CLASS: 'fixture-settingSurface', SETTINGS_PRIMARY_BUTTON_CLASS: 'fixture-primaryAction', SETTINGS_SECONDARY_BUTTON_CLASS: 'fixture-secondaryAction' },
};

export function mountContract(file: string, name: string, options: {
    states?: Readonly<Record<number, unknown>>;
    props?: Record<string, unknown>;
    imports?: Record<string, unknown>;
    globals?: Record<string, unknown>;
} = {}) {
    const values = new Map<number, unknown>(Object.entries(options.states ?? {}).map(([key, value]) => [Number(key), value]));
    const refs = new Map<number, { current: unknown }>();
    const effects: Array<() => unknown> = [];
    let cursor = 0, refCursor = 0, idCursor = 0;
    const react = {
        useState(initial: unknown) {
            const index = cursor++;
            if (!values.has(index)) values.set(index, typeof initial === 'function' ? (initial as () => unknown)() : initial);
            return [values.get(index), (next: unknown) => values.set(index, typeof next === 'function' ? (next as (previous: unknown) => unknown)(values.get(index)) : next)];
        },
        useEffect(callback: () => unknown) { effects.push(callback); },
        useId() { return `synthetic-id-${idCursor++}`; },
        useMemo(callback: () => unknown) { return callback(); },
        useRef(initial: unknown) { const index = refCursor++; if (!refs.has(index)) refs.set(index, { current: initial }); return refs.get(index); },
    };
    const filename = resolve(file), module = { exports: {} as Record<string, unknown> };
    const packageRequire = createRequire(filename);
    const imports: Record<string, unknown> = { ...frameworkDoubles, ...options.imports };
    const source = readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: {
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } });
    assert.equal(compiled.diagnostics?.length ?? 0, 0);
    const requireDouble = (specifier: string): unknown => {
        if (specifier === 'react') return react;
        if (specifier === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: Symbol.for('test-fragment') };
        if (Object.hasOwn(imports, specifier)) return { __esModule: true, ...(imports[specifier] as object) };
        if (specifier.endsWith('.module.css')) return { __esModule: true, default: css };
        if (specifier === 'lucide-react') return new Proxy({}, { get: (_target, icon) => (props: Record<string, unknown>) => element('svg', { ...props, 'data-fixture-icon': String(icon) }) });
        if (specifier.startsWith('node:')) return packageRequire(specifier);
        throw new Error(`Undeclared test dependency: ${specifier}`);
    };
    const unexpectedNetwork = () => { throw new Error('Unexpected network in presentation contract test'); };
    runInNewContext(compiled.outputText, { module, exports: module.exports, require: requireDouble,
        Date, setTimeout, clearTimeout, AbortController, AbortSignal, fetch: unexpectedNetwork, ...options.globals }, { filename });
    function expand(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(expand);
        if (!value || typeof value !== 'object' || !('type' in value)) return value;
        const node = value as TestNode;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props.children) } };
    }
    function render() {
        cursor = 0; refCursor = 0; idCursor = 0; effects.length = 0;
        return expand((module.exports[name] as (props: Record<string, unknown>) => unknown)(options.props ?? {}));
    }
    return { render, values, effects };
}
