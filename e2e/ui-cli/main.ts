import { createReadStream } from 'node:fs';
import { appendFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { actionSchema } from './commands.ts';
import { drive, openBrowser } from './browser.ts';
import { openGpuiRenderer } from './gpui-renderer.ts';
import type { Action } from './commands.ts';
import { launchRuntime } from './runtime.ts';

async function openWeb(build: string, output: string, revision: string, signal: AbortSignal) {
  const runtime = await launchRuntime(build, output, revision, signal);
  try {
    const { browser, page, failures } = await openBrowser(runtime.origin);
    return {
      identity: { surface: 'web', emptyArchive: true, chrome: browser.version(), node: process.versions.node,
        build: runtime.metadata, observed: runtime.observed, serverSHA256: runtime.serverSHA256, chromiumSandbox: true, allowedOrigin: runtime.origin },
      failures,
      drive: (action: Action) => drive(page, action, output),
      async close() { try { await browser.close(); } finally { await runtime.cleanup(); } },
    };
  } catch (error) {
    await runtime.cleanup();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    build: { type: 'string' }, revision: { type: 'string' }, out: { type: 'string' },
    surface: { type: 'string', default: 'web' }, file: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run test:ui:cli -- [--surface web|gpui-renderer|gpui-shell] --build BUILD --revision SHA --out CARTELLA_PROVE [--file AZIONI.jsonl]');
    return;
  }
  if (!values.build || !values.revision?.match(/^[a-f0-9]{40}$/u) || !values.out) {
    throw new Error('Indica --build, --revision (SHA completo) e --out (cartella esistente).');
  }
  if (values.surface !== 'web' && values.surface !== 'gpui-renderer' && values.surface !== 'gpui-shell') throw new Error('Superficie attesa: web, gpui-renderer o gpui-shell.');
  const output = await mkdtemp(join(resolve(values.out), `${values.surface}-`));
  const receipt = join(output, 'ricevuta.jsonl');
  const emit = async (event: object) => {
    const line = JSON.stringify(event) + '\n';
    await appendFile(receipt, line, { mode: 0o600 });
    process.stdout.write(line);
  };
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Collaudo interrotto.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let line = 0;
  let completed = 0;
  let requests: object[] | undefined;
  try {
    const build = resolve(values.build);
    const session = values.surface === 'web'
      ? await openWeb(build, output, values.revision, abort.signal)
      : await openGpuiRenderer(build, output, values.revision, abort.signal, values.surface);
    if ('failures' in session) requests = session.failures;
    try {
      const input = values.file ? createReadStream(values.file, 'utf8') : process.stdin;
      const stream = createInterface({ input, crlfDelay: Infinity, terminal: false });
      const lines = stream[Symbol.asyncIterator]();
      const close = () => stream.close();
      abort.signal.addEventListener('abort', close, { once: true });
      try {
        await emit({ type: 'ready', output, ...session.identity });
        abort.signal.throwIfAborted();
        for (let next = await lines.next(); !next.done; next = await lines.next()) {
          const text = next.value;
          abort.signal.throwIfAborted();
          line += 1;
          if (!text.trim()) continue;
          if (text.length > 65_536) throw new Error('Riga troppo lunga.');
          const action = actionSchema.parse(JSON.parse(text));
          const data = await session.drive(action);
          await emit({ type: 'step', line, op: action.op, ok: true, data });
          completed += 1;
        }
        abort.signal.throwIfAborted();
        if (!completed) throw new Error('Nessuna azione eseguita.');
      } finally {
        close();
        if (values.file) input.destroy();
      }
    } finally {
      await session.close();
    }
    await emit({ type: 'result', ok: true, completed });
  } catch (error) {
    await emit({ type: 'result', ok: false, line, completed, ...(requests?.length ? { requests } : {}), error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
