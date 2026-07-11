import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOllamaBaseUrl, resolveOllamaBaseUrl } from './base-url.ts';
import { buildOllamaChatPayload, OllamaProviderAdapter, toOllamaMessages } from './ollama.ts';

/* @Codex */
test('normalizza URL Ollama e applica l euristica anti-8080', () => {
    assert.equal(normalizeOllamaBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434');
    assert.equal(normalizeOllamaBaseUrl('http://127.0.0.1:11434/v/'), 'http://127.0.0.1:11434');
    assert.equal(
        resolveOllamaBaseUrl('http://127.0.0.1:8080/v1', 'http://127.0.0.1:11434/v1'),
        'http://127.0.0.1:11434',
    );
    assert.equal(
        resolveOllamaBaseUrl('http://127.0.0.1:8080', undefined),
        'http://127.0.0.1:11434',
    );
});

test('mappa i messaggi multimodali Ollama separando testo e immagini', () => {
    assert.deepEqual(toOllamaMessages([{
        role: 'user',
        content: [
            { type: 'text', text: 'Leggi il documento' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
            { type: 'text', text: 'e restituisci JSON' },
        ],
    }]), [{
        role: 'user',
        content: 'Leggi il documento\n\ne restituisci JSON',
        images: ['abc123'],
    }]);
});

test('costruisce il payload con think:false solo per task testuali', () => {
    const textualPayload = buildOllamaChatPayload('qwen', [{ role: 'user', content: 'ciao' }], 512, { responseFormat: 'json', numCtx: 8192 }, true);
    const ocrPayload = buildOllamaChatPayload('deepseek-ocr', [{ role: 'user', content: 'leggi' }], undefined, undefined, false);

    assert.equal(textualPayload.think, false);
    assert.equal(textualPayload.stream, false);
    assert.equal(textualPayload.keep_alive, '30m');
    assert.equal(textualPayload.options.temperature, 0.4);
    assert.equal(textualPayload.options.num_predict, 512);
    assert.equal(textualPayload.options.num_ctx, 8192);
    assert.equal(textualPayload.format, 'json');
    assert.equal('think' in ocrPayload, false);
    assert.equal('num_ctx' in ocrPayload.options, false);
});

test('distingue il timeout dall annullamento utente', async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const timeoutAdapter = new OllamaProviderAdapter({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen',
        chatTimeoutMs: 1,
    });
    await assert.rejects(
        () => timeoutAdapter.chat([{ role: 'user', content: 'ciao' }]),
        /Timeout del provider AI dopo 0s\. Verifica che il modello sia caricato e riprova\./,
    );

    const controller = new AbortController();
    const userAbortAdapter = new OllamaProviderAdapter({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen',
        chatTimeoutMs: 1000,
    });
    const request = userAbortAdapter.chat([{ role: 'user', content: 'ciao' }], controller.signal);
    controller.abort(new Error('annullamento utente'));
    await assert.rejects(request, /annullamento utente/);
});
