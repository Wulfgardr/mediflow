import { readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';

async function eventFiles(distDir) {
  let entries;
  try {
    entries = await readdir(distDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => /^_events_\d+\.json$/.test(entry.name)).map((entry) => {
    if (!entry.isFile()) throw new Error(`Unexpected Next telemetry entry: ${entry.name}`);
    return entry.name;
  });
}

// Pinned Next flushDetached writes these receipts before spawning its worker.
// detached-flush unlinks each receipt only after its last workspace write.
// Waiting for the launcher alone does not cover that detached worker.
export async function waitForNextDevTelemetry(distDir, { timeoutMs = 10_000, pollMs = 25 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('Telemetry wait requires positive finite time limits');
  }
  const initial = new Set(await eventFiles(distDir));
  if (initial.size === 0) return;
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const pending = await eventFiles(distDir);
    if (pending.some((name) => !initial.has(name))) {
      throw new Error('Next telemetry receipt appeared after launcher shutdown; workspace retained');
    }
    if (pending.length === 0) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(`Next telemetry did not complete: ${pending.join(', ')}; workspace retained`);
    }
    await setTimeout(Math.min(pollMs, remaining));
  }
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error('Next development dist directory is required');
  await waitForNextDevTelemetry(process.argv[2]);
}
