const TARGET_RATE = 16000;
const BLOCK_SAMPLES = 6400;

class LocalVoiceCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ratio = sampleRate / TARGET_RATE;
        this.boundary = this.ratio;
        this.index = 0;
        this.sum = 0;
        this.count = 0;
        this.block = new Int16Array(BLOCK_SAMPLES);
        this.filled = 0;
        this.port.onmessage = (event) => {
            if (event.data !== 'flush') return;
            this.emit(true);
        };
    }

    emit(final) {
        const pcm = this.block.slice(0, this.filled);
        this.filled = 0;
        this.port.postMessage({ pcm, final }, [pcm.buffer]);
    }

    push(value) {
        const clamped = Math.max(-1, Math.min(1, value));
        this.block[this.filled] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
        this.filled += 1;
        if (this.filled === BLOCK_SAMPLES) this.emit(false);
    }

    process(inputs) {
        const channels = inputs[0];
        if (!channels || channels.length === 0) return true;
        const frames = channels[0].length;
        for (let frame = 0; frame < frames; frame += 1) {
            let mixed = 0;
            for (const channel of channels) mixed += channel[frame];
            this.sum += mixed / channels.length;
            this.count += 1;
            this.index += 1;
            if (this.index >= this.boundary) {
                this.push(this.sum / this.count);
                this.sum = 0;
                this.count = 0;
                this.boundary += this.ratio;
            }
        }
        return true;
    }
}

registerProcessor('mediflow-local-voice-capture', LocalVoiceCapture);
