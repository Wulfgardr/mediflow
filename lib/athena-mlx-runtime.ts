/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
    ATHENA_MLX_DEFAULT_MAX_TOKENS,
    ATHENA_MLX_HARD_MAX_TOKENS,
    ATHENA_R1_QWEN3_8B_LOCAL_NAME,
    ATHENA_R1_QWEN3_8B_MODEL_ID,
} from './athena-model-identity';

export const ATHENA_MLX_LM_PACKAGE = process.env.MEDIFLOW_ATHENA_MLX_LM_PACKAGE || 'mlx-lm==0.29.1';

export interface AthenaMlxGenerateOptions {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    seed?: number;
    timeoutMs?: number;
    modelDir?: string;
}

export interface AthenaMlxGenerateResult {
    content: string;
    latencyMs: number;
    modelDir: string;
    model: string;
    artifactKind: AthenaMlxModelArtifactKind;
    quantizationBits?: number;
}

export type AthenaMlxModelArtifactKind =
    | 'huggingface_bf16_sharded'
    | 'mlx_converted'
    | 'mlx_converted_quantized';

export interface AthenaMlxModelArtifact {
    modelDir: string;
    available: boolean;
    artifactKind: AthenaMlxModelArtifactKind | null;
    missingFiles: string[];
    quantizationBits?: number;
}

export type AthenaMlxLauncher = Readonly<{
    mode: 'direct' | 'uvx';
    command: string;
    prefixArgs: readonly string[];
}>;

const HF_BF16_REQUIRED_MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'model.safetensors.index.json',
    'model-00001-of-00004.safetensors',
    'model-00002-of-00004.safetensors',
    'model-00003-of-00004.safetensors',
    'model-00004-of-00004.safetensors',
];

const MLX_CONVERTED_REQUIRED_MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'model.safetensors',
];

function shellBin(name: string): string {
    return process.env[name] || '';
}

/**
 * Resolves either a pre-provisioned offline runner or the historical uvx
 * launcher. The direct override is a host-owned executable path only: no
 * arguments, shell fragments, package resolution or network access cross the
 * boundary.
 */
export function resolveAthenaMlxLauncher(): AthenaMlxLauncher {
    const direct = (process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN || '').trim();
    if (direct) {
        try {
            if (!path.isAbsolute(direct) || path.basename(direct) !== 'mlx_lm.generate') {
                throw new Error('invalid');
            }
            if (!fs.statSync(direct).isFile()) throw new Error('invalid');
            fs.accessSync(direct, fs.constants.X_OK);
        } catch {
            throw new Error('ATHENA MLX direct runner configuration rejected.');
        }
        return Object.freeze({
            mode: 'direct' as const,
            command: direct,
            prefixArgs: Object.freeze([] as string[]),
        });
    }

    const uvx = shellBin('MEDIFLOW_UVX_BIN') || 'uvx';
    const python = process.env.MEDIFLOW_ATHENA_MLX_PYTHON || '3.12';
    return Object.freeze({
        mode: 'uvx' as const,
        command: uvx,
        prefixArgs: Object.freeze([
            '--python',
            python,
            '--with',
            'transformers==4.56.2',
            '--from',
            ATHENA_MLX_LM_PACKAGE,
            'mlx_lm.generate',
        ]),
    });
}

export function defaultAthenaMlxModelDir(): string {
    return process.env.MEDIFLOW_ATHENA_MODEL_DIR
        || path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow', 'models', ATHENA_R1_QWEN3_8B_LOCAL_NAME);
}

function missingFiles(modelDir: string, files: string[]): string[] {
    return files.filter((fileName) => !fs.existsSync(path.join(modelDir, fileName)));
}

function readQuantizationBits(modelDir: string): number | undefined {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(modelDir, 'config.json'), 'utf8')) as {
            quantization?: { bits?: unknown };
        };
        const bits = raw.quantization?.bits;
        return typeof bits === 'number' && Number.isFinite(bits) ? bits : undefined;
    } catch {
        return undefined;
    }
}

export function describeAthenaMlxModelArtifact(modelDir = defaultAthenaMlxModelDir()): AthenaMlxModelArtifact {
    const hfMissing = missingFiles(modelDir, HF_BF16_REQUIRED_MODEL_FILES);
    if (hfMissing.length === 0) {
        return {
            modelDir,
            available: true,
            artifactKind: 'huggingface_bf16_sharded',
            missingFiles: [],
        };
    }

    const convertedMissing = missingFiles(modelDir, MLX_CONVERTED_REQUIRED_MODEL_FILES);
    if (convertedMissing.length === 0) {
        const quantizationBits = readQuantizationBits(modelDir);
        return {
            modelDir,
            available: true,
            artifactKind: quantizationBits ? 'mlx_converted_quantized' : 'mlx_converted',
            missingFiles: [],
            quantizationBits,
        };
    }

    return {
        modelDir,
        available: false,
        artifactKind: null,
        missingFiles: Array.from(new Set([...hfMissing, ...convertedMissing])),
    };
}

export function isAthenaMlxModelAvailable(modelDir = defaultAthenaMlxModelDir()): boolean {
    return describeAthenaMlxModelArtifact(modelDir).available;
}

export function resolveAthenaMlxMaxTokens(value?: number): number {
    const envValue = Number.parseInt(process.env.MEDIFLOW_ATHENA_MAX_TOKENS || '', 10);
    const requested = value ?? (Number.isFinite(envValue) ? envValue : ATHENA_MLX_DEFAULT_MAX_TOKENS);
    return Math.max(64, Math.min(Math.floor(requested), ATHENA_MLX_HARD_MAX_TOKENS));
}

function sanitizeMlxOutput(value: string): string {
    return value
        .split('\n')
        .filter((line) => !/mx\.metal\.device_info is deprecated/i.test(line))
        .join('\n')
        .trim();
}

export async function generateWithAthenaMlx(options: AthenaMlxGenerateOptions): Promise<AthenaMlxGenerateResult> {
    const modelDir = options.modelDir || defaultAthenaMlxModelDir();
    const artifact = describeAthenaMlxModelArtifact(modelDir);
    const artifactKind = artifact.artifactKind;
    if (!artifact.available || !artifactKind) {
        throw new Error(`ATHENA-R1-Qwen3-8B local model artifact is incomplete or missing at ${modelDir}; missing: ${artifact.missingFiles.join(', ')}`);
    }

    const launcher = resolveAthenaMlxLauncher();
    const maxTokens = String(resolveAthenaMlxMaxTokens(options.maxTokens));
    const temperature = String(options.temperature ?? 0);
    const topP = String(options.topP ?? 1);
    const envSeed = Number.parseInt(process.env.MEDIFLOW_ATHENA_SEED || '', 10);
    const seed = String(options.seed ?? (Number.isFinite(envSeed) ? envSeed : 7));
    const timeoutMs = options.timeoutMs ?? 420_000;
    const start = performance.now();
    const args = [
        ...launcher.prefixArgs,
        '--model',
        modelDir,
        '--prompt',
        '-',
        '--max-tokens',
        maxTokens,
        '--temp',
        temperature,
        '--top-p',
        topP,
        '--seed',
        seed,
        '--chat-template-config',
        '{"enable_thinking": false}',
        '--verbose',
        'False',
    ];

    return new Promise((resolve, reject) => {
        let forceKillTimer: NodeJS.Timeout | null = null;
        const child = spawn(launcher.command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                HF_HUB_OFFLINE: '1',
                TRANSFORMERS_OFFLINE: '1',
                UV_OFFLINE: '1',
                TOKENIZERS_PARALLELISM: 'false',
            },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            forceKillTimer = setTimeout(() => {
                child.kill('SIGKILL');
            }, 5_000);
            reject(new Error(`ATHENA MLX generation timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            if (code !== 0) {
                const trimmedStderr = stderr.trim();
                if (trimmedStderr) {
                    // Keep diagnostics out of the thrown error (it can reach HTTP
                    // clients); the sanitized tail lands only in the local server console.
                    console.warn(`[MediFlow] ATHENA MLX runtime exited with code ${code ?? 'unknown'}; sanitized diagnostics tail: ${sanitizeMlxOutput(trimmedStderr).slice(-2000)}`);
                }
                const diagnostics = trimmedStderr ? ' Sanitized diagnostics were logged to the local server console.' : '';
                reject(new Error(`ATHENA MLX generation failed with exit ${code ?? 'unknown'}.${diagnostics} Check local ATHENA MLX setup.`));
                return;
            }

            resolve({
                content: sanitizeMlxOutput(stdout),
                latencyMs: Number((performance.now() - start).toFixed(1)),
                modelDir,
                model: ATHENA_R1_QWEN3_8B_MODEL_ID,
                artifactKind,
                quantizationBits: artifact.quantizationBits,
            });
        });
        child.stdin.on('error', () => {
            // EPIPE from a child that exited before reading the prompt: the child
            // 'error'/'close' handlers own the rejection; never crash the server.
        });
        child.stdin.end(options.prompt);
    });
}
