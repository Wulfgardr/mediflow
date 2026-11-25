export type MicrophoneFailure = 'permission-denied' | 'unsupported';

export class MicrophoneUnavailable extends Error {
    constructor(readonly reason: MicrophoneFailure) {
        super(reason);
    }
}

export type OpenMicrophone = {
    flush(): Promise<void>;
    close(): Promise<void>;
};

/** Opens the page microphone and hands 16 kHz mono PCM s16le blocks to `onBlock`; nothing is kept after the hand-off. */
export async function openMicrophone(onBlock: (pcm: Uint8Array) => void): Promise<OpenMicrophone> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new MicrophoneUnavailable('unsupported');
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
        throw new MicrophoneUnavailable(error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') ? 'unsupported' : 'permission-denied');
    }
    const context = new AudioContext();
    try {
        await context.audioWorklet.addModule('/local-voice-worklet.js');
    } catch {
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => undefined);
        throw new MicrophoneUnavailable('unsupported');
    }
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'mediflow-local-voice-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    let flushed: (() => void) | null = null;
    capture.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; final: boolean }>) => {
        const { pcm, final } = event.data;
        if (pcm.length > 0) onBlock(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        if (final) { flushed?.(); flushed = null; }
    };
    source.connect(capture);
    await context.resume();
    let closed = false;
    return {
        flush: () => closed ? Promise.resolve() : new Promise<void>((resolve) => {
            flushed = resolve;
            capture.port.postMessage('flush');
        }),
        async close() {
            if (closed) return;
            closed = true;
            stream.getTracks().forEach((track) => track.stop());
            source.disconnect();
            capture.port.onmessage = null;
            await context.close().catch(() => undefined);
        },
    };
}
