import { localVoiceEndpoint } from '../lib/local-voice/client.mjs';

export const LOCAL_VOICE_ENDPOINT_FRAME = 'mediflow-local-voice-endpoint';
export const LOCAL_VOICE_ENDPOINT_REQUEST = 'mediflow-local-voice-endpoint-request';
const subscribed = new WeakSet();

/**
 * The launcher tells the Web runtime where the voice service answers now. Anything but a valid loopback
 * endpoint clears it: the Web then reports that local recording is not available. After subscribing the
 * Web asks for the current endpoint, so an update sent before the subscription is never lost.
 * @param {NodeJS.Process} channel @param {NodeJS.ProcessEnv} [env]
 */
export function installLocalVoiceEndpoint(channel, env = process.env) {
  if (!subscribed.has(channel)) {
    subscribed.add(channel);
    channel.on('message', function localVoiceEndpointFrame(frame) {
      if (frame?.type !== LOCAL_VOICE_ENDPOINT_FRAME) return;
      const endpoint = localVoiceEndpoint(frame.url, frame.secret);
      if (endpoint) Object.assign(env, { MEDIFLOW_LOCAL_VOICE_URL: endpoint.url, MEDIFLOW_LOCAL_VOICE_SECRET: endpoint.secret });
      else { delete env.MEDIFLOW_LOCAL_VOICE_URL; delete env.MEDIFLOW_LOCAL_VOICE_SECRET; }
    });
  }
  if (channel.connected) channel.send?.({ type: LOCAL_VOICE_ENDPOINT_REQUEST }, () => {});
}
