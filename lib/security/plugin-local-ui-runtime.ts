import 'server-only';

export function isPluginLocalUiRuntime(): boolean {
  return process.env.MEDIFLOW_PLUGIN_LOCAL_UI === '1' && process.connected === true;
}
