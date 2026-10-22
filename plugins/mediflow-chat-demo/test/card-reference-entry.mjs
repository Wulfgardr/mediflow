import { connectToServer, callTool, loadSandboxProxy, initializeApp, newAppBridge } from 'ext-apps-reference-implementation';
const server = await connectToServer(new URL('http://localhost:3017/mcp'));
const params = new URLSearchParams(location.search);
const info = callTool(server, params.has('inline') ? 'mediflow_synthetic_card_open' : 'mediflow_synthetic_card', {});
const resource = await info.appResourcePromise;
const iframe = document.querySelector('iframe');
await loadSandboxProxy(iframe, resource.csp, resource.permissions);
window['cardContexts'] = [];
const bridge = newAppBridge(server, iframe, { onContextUpdate: context => window['cardContexts'].push(context) }, { containerDimensions: { maxHeight: 720 } });
window['cardBridge'] = bridge;
window['cardSizes'] = [];
const resize = bridge.onsizechange;
bridge.onsizechange = params => { window['cardSizes'].push(params); return resize(params); };
if (params.has('reject-context')) bridge.onupdatemodelcontext = async () => { throw new Error('Context update denied'); };
if (params.has('thread')) {
  const input = bridge.sendToolInput.bind(bridge), result = bridge.sendToolResult.bind(bridge);
  bridge.sendToolInput = value => { bridge.sendToolInput = input; };
  bridge.sendToolResult = value => { bridge.sendToolResult = result; };
}
await initializeApp(iframe, bridge, info);
