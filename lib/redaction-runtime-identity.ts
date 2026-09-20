/* @Codex — public identity constants; these are not runtime authority. */
export const REDACTION_RUNTIME_SCHEMA = 'mediflow.redaction-runtime-binding.v1' as const;
export const REDACTION_RUNTIME_ADAPTER = 'mediflow.layer1-gliner.runtime.v1' as const;
export const REDACTION_RUNTIME_MODEL = 'gliner2-pii' as const;
export const REDACTION_RUNTIME_REVISION = 'c153999da5f4c509df4322b0c6a1baf3d2c284d7' as const;
export const REDACTION_RUNTIME_PACKAGES = Object.freeze({ gliner2: '2.0.0', torch: '2.14.0', transformers: '4.57.6', 'huggingface-hub': '0.36.2' });
export const REDACTION_RUNTIME_FILES = Object.freeze({
    'model.safetensors': '0280f6f39f6012da50b6640bad438d9b7e763a1b0102094115d1b710c4dd79b6',
    'config.json': '164f17362bcf9d114067d3465e7374bfdd79ce6b605acb745de5a49dabb9595c',
    'encoder_config/config.json': 'f27dd63cc43a248d2566f0b6ad7a115db353676ce0561dcbca45bac766464c1a',
    'tokenizer.json': 'f6df10ec83bea993035b2dd7c39345a3d4fcf23421c2adb6cb4ffc1e6d1bc4b5',
    'tokenizer_config.json': '8c916ee43ae43bf5945499f0405cac73da2b31f3ba04cf8c74a41cbd152b6330',
});
// Updated only with the bundled worker, never supplied in an HTTP request.
export const REDACTION_WORKER_SHA256 = '6676afbddd6b30d3516183f87290613969dfcd89b027ca61985a03f49f8fb71d';
export type RedactionRuntimeIdentity = Readonly<{
    schema: typeof REDACTION_RUNTIME_SCHEMA; adapter: typeof REDACTION_RUNTIME_ADAPTER;
    model: typeof REDACTION_RUNTIME_MODEL; revision: typeof REDACTION_RUNTIME_REVISION;
    workerSha256: string; pythonSha256: string;
    files: typeof REDACTION_RUNTIME_FILES; packages: typeof REDACTION_RUNTIME_PACKAGES;
}>;
