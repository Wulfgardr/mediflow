import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

for (const flag of ['0', '1']) {
  for (const ipc of [false, true]) {
    test(`plugin runtime declaration and event route agree with host flag ${flag}, IPC ${ipc}`, async () => {
      const child = spawn(process.execPath, ['--import', './scripts/register-strip-types-loader.mjs', '--input-type=module', '--eval', `
        const { isPluginLocalUiRuntime } = await import(${JSON.stringify(new URL('./plugin-local-ui-runtime.ts', import.meta.url).href)});
        const { localUiEvents } = await import(${JSON.stringify(new URL('./plugin-local-ui-events.ts', import.meta.url).href)});
        const controller = new AbortController();
        const response = localUiEvents(new Request('http://127.0.0.1/api/plugin-local-ui/events', { signal: controller.signal }));
        const crossSite = localUiEvents(new Request('http://127.0.0.1/api/plugin-local-ui/events', { headers: { 'sec-fetch-site': 'cross-site' } }));
        process.stdout.write(JSON.stringify({ enabled: isPluginLocalUiRuntime(), status: response.status, crossSite: crossSite.status }));
        controller.abort();
        process.disconnect?.();
      `], {
        env: { ...process.env, MEDIFLOW_PLUGIN_LOCAL_UI: flag },
        stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout!.on('data', chunk => { stdout += chunk; });
      child.stderr!.on('data', chunk => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      assert.equal(code, 0, stderr);
      const enabled = flag === '1' && ipc;
      assert.deepEqual(JSON.parse(stdout), { enabled, status: enabled ? 200 : 404, crossSite: 404 });
    });
  }
}
