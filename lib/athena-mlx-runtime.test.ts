import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    ATHENA_MLX_DEFAULT_MAX_TOKENS,
    ATHENA_MLX_HARD_MAX_TOKENS,
} from './athena-model-identity';
import {
    describeAthenaMlxModelArtifact,
    isAthenaMlxModelAvailable,
    resolveAthenaMlxLauncher,
    resolveAthenaMlxMaxTokens,
} from './athena-mlx-runtime';

function makeTempModelDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-athena-model-'));
}

function writeFixtureFiles(modelDir: string, fileNames: string[]): void {
    for (const fileName of fileNames) {
        fs.writeFileSync(path.join(modelDir, fileName), '{}', 'utf8');
    }
}

test('athena mlx runtime detects sharded Hugging Face BF16 artifact', () => {
    const modelDir = makeTempModelDir();
    writeFixtureFiles(modelDir, [
        'config.json',
        'tokenizer.json',
        'model.safetensors.index.json',
        'model-00001-of-00004.safetensors',
        'model-00002-of-00004.safetensors',
        'model-00003-of-00004.safetensors',
        'model-00004-of-00004.safetensors',
    ]);

    const artifact = describeAthenaMlxModelArtifact(modelDir);

    assert.equal(artifact.available, true);
    assert.equal(artifact.artifactKind, 'huggingface_bf16_sharded');
    assert.equal(isAthenaMlxModelAvailable(modelDir), true);
});

test('athena mlx runtime detects converted quantized MLX artifact', () => {
    const modelDir = makeTempModelDir();
    fs.writeFileSync(path.join(modelDir, 'config.json'), JSON.stringify({
        quantization: {
            bits: 4,
            group_size: 64,
            mode: 'affine',
        },
    }), 'utf8');
    writeFixtureFiles(modelDir, [
        'tokenizer.json',
        'model.safetensors',
    ]);

    const artifact = describeAthenaMlxModelArtifact(modelDir);

    assert.equal(artifact.available, true);
    assert.equal(artifact.artifactKind, 'mlx_converted_quantized');
    assert.equal(artifact.quantizationBits, 4);
    assert.equal(isAthenaMlxModelAvailable(modelDir), true);
});

test('athena mlx token limit keeps a fast default and hard upper bound', () => {
    const previous = process.env.MEDIFLOW_ATHENA_MAX_TOKENS;
    delete process.env.MEDIFLOW_ATHENA_MAX_TOKENS;
    try {
        assert.equal(resolveAthenaMlxMaxTokens(), ATHENA_MLX_DEFAULT_MAX_TOKENS);
        assert.equal(resolveAthenaMlxMaxTokens(12), 64);
        assert.equal(resolveAthenaMlxMaxTokens(ATHENA_MLX_HARD_MAX_TOKENS + 1), ATHENA_MLX_HARD_MAX_TOKENS);
    } finally {
        if (previous === undefined) {
            delete process.env.MEDIFLOW_ATHENA_MAX_TOKENS;
        } else {
            process.env.MEDIFLOW_ATHENA_MAX_TOKENS = previous;
        }
    }
});

test('athena mlx accepts only an explicit executable local runner override', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-athena-runner-'));
    const runner = path.join(fixtureDir, 'mlx_lm.generate');
    fs.writeFileSync(runner, '#!/bin/sh\nexit 0\n', { encoding: 'utf8', mode: 0o700 });
    const previous = process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN;

    try {
        process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = runner;
        assert.deepEqual(resolveAthenaMlxLauncher(), {
            mode: 'direct',
            command: runner,
            prefixArgs: [],
        });

        process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = './mlx_lm.generate';
        assert.throws(() => resolveAthenaMlxLauncher(), /direct runner/u);

        process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = path.join(fixtureDir, 'other-command');
        assert.throws(() => resolveAthenaMlxLauncher(), /direct runner/u);
    } finally {
        if (previous === undefined) delete process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN;
        else process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = previous;
    }
});

test('claims runner exposes intact stdout to the strict decoder while legacy sanitation stays unchanged', async t => {
    const { generateWithAthenaMlx, generateWithAthenaMlxClaims } = await import('./athena-mlx-runtime');
    const { athenaClaimsProfileV1 } = await import('./ai-providers/fabric/treatment-reasoning-athena-claims-profile');
    const modelDir = makeTempModelDir(); t.after(() => fs.rmSync(modelDir, { recursive: true, force: true }));
    writeFixtureFiles(modelDir, ['config.json', 'tokenizer.json', 'model.safetensors']);
    const runner = path.join(modelDir, 'mlx_lm.generate');
    fs.writeFileSync(runner, '#!/bin/sh\n/bin/cat > /dev/null\n/bin/cat "'+path.join(modelDir, 'stdout')+'"\n', { mode: 0o700 });
    const previous = process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN;
    process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = runner;
    t.after(() => { if (previous === undefined) delete process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN; else process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN = previous; });
    const pair = { claim: 'Revisione sintetica.', evidenceRefs: ['source.synthetic'] };
    const clean = JSON.stringify({ schemaVersion: athenaClaimsProfileV1.id, task: 'treatment_reasoning', summary: pair, data: { recommendation: pair, keyEvidence: [], reasoning: [], caveats: [], safetyFlags: [], suggestedActions: [], trace: { mode: 'local_model', toolsUsed: [], limitations: [] } } });
    const raw = ' ' + clean + '\nmx.metal.device_info is deprecated\n';
    fs.writeFileSync(path.join(modelDir, 'stdout'), raw);
    const options = { prompt: 'Synthetic boundary test', modelDir, timeoutMs: 1000 };
    const result = await generateWithAthenaMlxClaims(options);
    assert.equal(result.content, raw);
    const config = { allowedEvidenceRefs: ['source.synthetic'], attestation: { schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef: 'receipt.synthetic', provenanceRef: 'provenance.synthetic' } };
    assert.equal(athenaClaimsProfileV1.normalize(clean, config).status, 'accepted');
    assert.equal(athenaClaimsProfileV1.normalize(result.content, config).status, 'denied');
    assert.equal((await generateWithAthenaMlx(options)).content, clean);
});
