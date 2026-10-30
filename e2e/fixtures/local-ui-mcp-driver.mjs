import { fixture } from '../../lib/security/local-ui-mcp-test-fixture.ts';

let ack;
let dispatched = 0;
const mcp = fixture(true, intent => new Promise((resolve, reject) => {
  dispatched++;
  ack = status => status === 'accepted' ? resolve() : reject(new Error('navigation denied'));
  process.send({ navigate: intent });
}));
process.on('message', async message => {
  if (message.ack) { ack?.(message.ack); return; }
  try {
    let result;
    if (message.command === 'call') result = await mcp.request('tools/call', { name: 'mediflow.local_ui.navigate.v1', arguments: { intent: 'history' } });
    if (message.command === 'duplicate') {
      const frame = mcp.childFrames.find(frame => frame.operationId === 'mediflow.local_ui.navigate.v1');
      if (!frame) throw new Error('Missing original RPC');
      mcp.child.emit('message', JSON.stringify(frame));
      await new Promise(resolve => setImmediate(resolve));
      result = { dispatched, conflict: mcp.parentFrames.some(frame => frame.denialCode === 'request_conflict'),
        wire: [...mcp.wire, ...mcp.stderr, JSON.stringify(mcp.parentFrames), JSON.stringify(mcp.childFrames)].join('\n') };
    }
    process.send({ id: message.id, result });
  } catch (error) { process.send({ id: message.id, error: error.message }); }
});
process.once('disconnect', () => { mcp.runtime.terminate(); });
