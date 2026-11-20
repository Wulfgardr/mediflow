import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import type { Action } from './commands.ts';

const testNames = {
  'gpui-renderer': 'demo_app::ui_cli::demo_ui_cli',
  'gpui-shell': 'shell::ui_cli::shell_ui_cli',
} as const;
export type GpuiSurface = keyof typeof testNames;
const prefix = 'MEDIFLOW_UI_CLI ';

export async function openGpuiRenderer(build: string, output: string, revision: string, signal: AbortSignal, surface: GpuiSurface) {
  const binary = await realpath(build);
  const binarySHA256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  signal.throwIfAborted();
  const child = spawn(binary, [testNames[surface], '--exact', '--nocapture'], {
    cwd: output,
    env: { NODE_ENV: 'test', SystemRoot: process.env.SystemRoot, MEDIFLOW_UI_CLI: '1' },
    stdio: 'pipe',
  });
  child.stdin.on('error', () => {});
  const log = createWriteStream(join(output, 'gpui-renderer.log'), { flags: 'wx', mode: 0o600 });
  const logClosed = finished(log).catch(error => error);
  child.stderr.pipe(log, { end: false });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  const launchError = new Promise<never>((_, reject) => child.once('error', reject));
  const lines = createInterface({ input: child.stdout, terminal: false });
  const replies = lines[Symbol.asyncIterator]();
  const reply = async () => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    deadline.throwIfAborted();
    let onTimeout: () => void = () => {};
    try {
      const expired = new Promise<never>((_, reject) => {
        onTimeout = () => reject(new Error('Timeout o interruzione del renderer GPUI.'));
        deadline.addEventListener('abort', onTimeout, { once: true });
      });
      for (;;) {
        const result = await Promise.race([replies.next(), launchError, expired]);
        if (result.done) throw new Error('Il renderer GPUI si è chiuso senza esito.');
        const marker = result.value.indexOf(prefix);
        if (marker < 0) {
          log.write(result.value + '\n');
          continue;
        }
        const message = JSON.parse(result.value.slice(marker + prefix.length));
        if (message.ok !== true) throw new Error(message.error || 'Azione del renderer GPUI fallita.');
        return message;
      }
    } finally {
      deadline.removeEventListener('abort', onTimeout);
    }
  };
  const close = async () => {
    child.stdin.end();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 6_000);
    try { return await closed; } finally {
      clearTimeout(deadline);
      lines.close();
      log.end();
      const failure = await logClosed;
      if (failure instanceof Error) throw failure;
    }
  };
  let failed = false;
  try {
    const ready = await reply();
    if (ready.revision !== revision) throw new Error('Revisione del renderer GPUI diversa da quella richiesta.');
    return {
      identity: { revision, binarySHA256, surface, mode: surface === 'gpui-shell' ? 'Shell con archivio sintetico in memoria' : 'dimostrazione' },
      async drive(action: Action) {
        if (action.op === 'resize' && surface !== 'gpui-shell') throw new Error('Resize non disponibile nella dimostrazione GPUI.');
        try {
          child.stdin.write(JSON.stringify(action) + '\n');
          return (await reply()).data;
        } catch (error) {
          failed = true;
          throw error;
        }
      },
      async close() {
        const code = await close();
        if (!failed && code !== 0) throw new Error(`Processo del renderer GPUI terminato con esito ${code}.`);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
