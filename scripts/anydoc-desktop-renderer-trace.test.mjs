/* @Codex: configuration tests, not proof of a built Windows/Linux bundle. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { anyDocDesktopRendererTrace } from './anydoc-desktop-renderer-trace.mjs';

test('desktop tracing selects only the explicit target package manifest and native binary', () => {
    for (const [platform, arch, suffix, binary] of [
        ['win32', 'x64', 'win32-x64-msvc', 'skia.win32-x64-msvc.node'],
        ['linux', 'x64', 'linux-x64-gnu', 'skia.linux-x64-gnu.node'],
        ['linux', 'arm64', 'linux-arm64-gnu', 'skia.linux-arm64-gnu.node'],
    ]) {
        const root = `./node_modules/@napi-rs/canvas-${suffix}`;
        assert.deepEqual(anyDocDesktopRendererTrace(platform, arch),
            [`${root}/package.json`, `${root}/${binary}`, `${root}/README.md`]);
    }
    for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'arm64'], ['linux', 'ia32'], ['freebsd', 'x64']]) {
        assert.deepEqual(anyDocDesktopRendererTrace(platform, arch), []);
    }
});

test('Next configuration wires the target trace without replacing the existing Mac roster', async () => {
    const loaded = await import('../next.config.ts');
    const config = loaded.default.default ?? loaded.default;
    const includes = config.outputFileTracingIncludes['/*'];
    assert.ok(includes.includes('./node_modules/@napi-rs/canvas-darwin-arm64/**/*'));
    for (const file of anyDocDesktopRendererTrace(process.platform, process.arch)) assert.ok(includes.includes(file));
    assert.match(readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8'),
        /\.\.\.anyDocDesktopRendererTrace\(process\.platform, process\.arch\)/u);
});
