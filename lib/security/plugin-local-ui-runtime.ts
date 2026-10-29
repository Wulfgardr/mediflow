import 'server-only';

export function isPluginLocalUiRuntime(): boolean {
  return process.env.MEDIFLOW_PLUGIN_LOCAL_UI === '1' && process.connected === true;
}

export function requiresLocalUiDocumentLease(): boolean {
  return isPluginLocalUiRuntime()
    && process.env.MEDIFLOW_RUNTIME_UI_LEASE === '1'
    && typeof (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('mediflow.local-ui.lease.v1')] === 'function';
}
