import 'server-only';
import type { LocalUiIntent } from '../../packages/mcp/src/local-ui-contract';

const symbol = Symbol.for('mediflow.local-ui.navigation.v1');
type Listener = (intent: LocalUiIntent | 'reset') => void;
type State = { listeners: Set<Listener> };
const stateKey = Symbol.for('mediflow.local-ui.listeners.v1');
const host = globalThis as unknown as Record<symbol, unknown>;
const state = (host[stateKey] ??= { listeners: new Set<Listener>() }) as State;
host[symbol] = (intent: LocalUiIntent) => {
  for (const listener of [...state.listeners]) listener(intent);
  return state.listeners.size > 0;
};

export function resetLocalUiNavigation() {
  for (const listener of [...state.listeners]) listener('reset');
}

export function localUiEvents(request: Request): Response {
  if (process.env.MEDIFLOW_PLUGIN_LOCAL_UI !== '1' || !process.connected
    || !['same-origin', 'none', null].includes(request.headers.get('sec-fetch-site'))) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const listener: Listener = intent => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${intent}\n\n`));
      };
      const timer = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 10_000);
      const disconnected = () => { cleanup(); };
      cleanup = () => {
        if (closed) return;
        closed = true; clearInterval(timer); state.listeners.delete(listener);
        request.signal.removeEventListener('abort', disconnected); process.off('disconnect', disconnected);
        controller.close();
      };
      state.listeners.add(listener);
      request.signal.addEventListener('abort', disconnected, { once: true });
      process.once('disconnect', disconnected);
      controller.enqueue(encoder.encode(': connected\n\n'));
      if (request.signal.aborted) cleanup();
    },
    cancel() { cleanup(); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' } });
}
