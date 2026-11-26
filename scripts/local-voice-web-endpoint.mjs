import { localVoiceEndpoint } from '../lib/local-voice/client.mjs';

export const LOCAL_VOICE_ENDPOINT_FRAME = 'mediflow-local-voice-endpoint';

/**
 * The launcher tells the Web runtime where the voice service answers now. Anything but a valid loopback
 * endpoint clears it: the Web then reports that local recording is not available.
 * @param {NodeJS.Process} channel @param {NodeJS.ProcessEnv} [env]
 */
export function installLocalVoiceEndpoint(channel, env = process.env) {
  channel.on('message', frame => {
    if (frame?.type !== LOCAL_VOICE_ENDPOINT_FRAME) return;
    const endpoint = localVoiceEndpoint(frame.url, frame.secret);
    if (endpoint) Object.assign(env, { MEDIFLOW_LOCAL_VOICE_URL: endpoint.url, MEDIFLOW_LOCAL_VOICE_SECRET: endpoint.secret });
    else { delete env.MEDIFLOW_LOCAL_VOICE_URL; delete env.MEDIFLOW_LOCAL_VOICE_SECRET; }
  });
}
