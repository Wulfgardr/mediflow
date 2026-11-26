import type { Page } from '@playwright/test';

export type SyntheticSound = { tone: number } | { pcm16k: string };

/** The page microphone becomes a synthetic source: a tone, or 16 kHz PCM spoken by `say`. */
export async function syntheticMicrophone(page: Page, sound: SyntheticSound) {
    await page.addInitScript((input) => {
        const devices = navigator.mediaDevices;
        const original = devices.getUserMedia.bind(devices);
        devices.getUserMedia = async (constraints) => {
            if (!constraints?.audio) return original(constraints);
            const context = new AudioContext();
            const output = context.createMediaStreamDestination();
            if ('tone' in input) {
                const tone = context.createOscillator();
                const level = context.createGain();
                tone.frequency.value = input.tone;
                level.gain.value = 0.35;
                tone.connect(level).connect(output);
                tone.start();
            } else {
                const bytes = Uint8Array.from(atob(input.pcm16k), (character) => character.charCodeAt(0));
                const samples = new Int16Array(bytes.buffer);
                const buffer = context.createBuffer(1, samples.length, 16_000);
                const channel = buffer.getChannelData(0);
                for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 0x8000;
                const voice = context.createBufferSource();
                voice.buffer = buffer;
                voice.connect(output);
                voice.start();
            }
            await context.resume();
            const [track] = output.stream.getAudioTracks();
            const stop = track.stop.bind(track);
            track.stop = () => { stop(); void context.close(); };
            return output.stream;
        };
    }, sound);
}

export async function syntheticPatient(page: Page, lastName: string): Promise<string> {
    return page.evaluate(async (surname) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Voce', lastName: surname, taxCode: `VCE${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}`, birthDate: '1960-01-01' }) });
        if (response.status !== 201) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, lastName);
}
