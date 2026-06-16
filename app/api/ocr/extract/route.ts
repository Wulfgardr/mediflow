import { NextRequest, NextResponse } from 'next/server';
import { extractDocumentWithAI, isLowSignalOcrText } from '@/lib/ocr-service';
import { AIService } from '@/lib/ai-service';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { inArray } from 'drizzle-orm';
/* @Codex */
import { execFile } from 'node:child_process';
/* @Codex */
import { promises as fs } from 'node:fs';
/* @Codex */
import os from 'node:os';
/* @Codex */
import path from 'node:path';
/* @Codex */
import { promisify } from 'node:util';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
import { validateLocalTarget } from '@/lib/local-target';

/* @Codex */
const execFileAsync = promisify(execFile);
/* @Codex */
const APPLE_VISION_SCRIPT = path.join(process.cwd(), 'scripts', 'apple-vision-ocr.swift');
/* @Codex */
const IMAGE_MIME_EXTENSION: Record<string, string> = {
    jpeg: 'jpg',
    jpg: 'jpg',
    png: 'png',
    tiff: 'tiff',
    tif: 'tif',
    bmp: 'bmp',
    heic: 'heic',
    heif: 'heif',
    webp: 'webp',
};

/* @Codex */
async function loadOcrRuntimeSettings() {
    const rows = await dbServer
        .select()
        .from(settings)
        .where(inArray(settings.key, ['aiUrl', 'ollamaUrl', 'aiModel_ocr']));

    const getValue = (key: string) => rows.find(row => row.key === key)?.value || null;
    const configuredModel = getValue('aiModel_ocr') || 'deepseek-ocr';
    const baseUrl = (getValue('aiUrl') || getValue('ollamaUrl') || 'http://127.0.0.1:11434')
        .replace(/\/v1\/?$/, '')
        .replace(/\/$/, '');

    return {
        configuredModel,
        baseUrl,
    };
}

/* @Codex */
function decodeImagePayload(image: string): { buffer: Buffer; extension: string } {
    const dataUrlMatch = image.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
    const extension = IMAGE_MIME_EXTENSION[(dataUrlMatch?.[1] || 'png').toLowerCase()] || 'png';
    const encoded = dataUrlMatch?.[2] || image;
    return { buffer: Buffer.from(encoded, 'base64'), extension };
}

/* @Codex */
function shouldFallbackToAppleVision(result: Awaited<ReturnType<typeof extractDocumentWithAI>>): boolean {
    const meaningfulFields = Boolean(
        result.firstName
        || result.lastName
        || result.taxCode
        || result.birthDate
        || result.address
        || result.diagnosis
        || result.medications?.length
    );
    if (meaningfulFields && result.confidence >= 0.5) return false;

    return result.confidence < 0.4
        || isLowSignalOcrText(result.rawMarkdown)
        || isLowSignalOcrText(result.notes);
}

/* @Codex */
async function extractWithAppleVisionFallback(image: string) {
    if (process.platform !== 'darwin') return null;

    try {
        await fs.access(APPLE_VISION_SCRIPT);
    } catch {
        return null;
    }

    const { buffer, extension } = decodeImagePayload(image);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediflow-ocr-'));
    const imagePath = path.join(tempDir, `input.${extension}`);

    try {
        await fs.writeFile(imagePath, buffer);
        const { stdout } = await execFileAsync('swift', [APPLE_VISION_SCRIPT, imagePath], {
            timeout: 45000,
            maxBuffer: 8 * 1024 * 1024,
        });
        const parsed = JSON.parse(stdout);
        const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
        if (!parsed.ok || isLowSignalOcrText(text)) return null;

        return {
            rawMarkdown: text,
            notes: text.slice(0, 500),
            confidence: Math.min(0.86, Math.max(0.55, Number(parsed.avg_confidence) || 0.72)),
            fallbackEngine: 'apple_vision' as const,
        };
    } catch (error) {
        console.warn('[OCR API] Apple Vision fallback failed:', error);
        return null;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

/**
 * POST /api/ocr/extract
 * 
 * Extract structured data from a document image using DeepSeek OCR 2.
 * Accepts base64 image data and returns structured patient/clinical data.
 */
export async function POST(request: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const { image, mode = 'patient' } = body;

        if (!image) {
            return NextResponse.json(
                { error: 'Image data required (base64)' },
                { status: 400 }
            );
        }

        // Validate mode
        if (!['full', 'patient', 'labs'].includes(mode)) {
            return NextResponse.json(
                { error: 'Invalid mode. Use: full, patient, or labs' },
                { status: 400 }
            );
        }

        const { configuredModel, baseUrl } = await loadOcrRuntimeSettings();
        const validation = validateLocalTarget(baseUrl);
        if (!validation.ok) {
            return NextResponse.json(
                { error: `Configured OCR endpoint not allowed: ${validation.reason}` },
                { status: 400 }
            );
        }

        const ai = new AIService('ollama', validation.url.toString(), configuredModel);
        /* @Codex */
        let result = await extractDocumentWithAI(image, mode, ai, { signal: request.signal });
        if (mode !== 'labs' && shouldFallbackToAppleVision(result)) {
            /* @Codex */
            if (request.signal.aborted) {
                return NextResponse.json(
                    { success: false, error: 'OCR extraction aborted' },
                    { status: 499 },
                );
            }
            const fallback = await extractWithAppleVisionFallback(image);
            if (fallback) {
                result = fallback;
            }
        }

        return NextResponse.json({
            success: true,
            data: result,
            confidence: result.confidence
        });

    } catch (error) {
        console.error('[API] OCR extraction error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'OCR extraction failed' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/ocr/extract
 * 
 * Check if OCR model is available
 */
export async function GET(request: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const { configuredModel, baseUrl } = await loadOcrRuntimeSettings();
        const validation = validateLocalTarget(baseUrl);
        if (!validation.ok) {
            return NextResponse.json({
                available: false,
                model: configuredModel,
                message: `Configured OCR endpoint not allowed: ${validation.reason}`
            });
        }

        const res = await fetch(`${validation.url.toString().replace(/\/$/, '')}/api/tags`);
        if (!res.ok) {
            return NextResponse.json({
                available: false,
                model: configuredModel,
                message: 'Ollama not reachable'
            });
        }

        const data = await res.json();
        const models = data.models || [];

        const normalizedConfigured = configuredModel.toLowerCase();
        const isConfiguredPresent = models.some((m: { name: string }) => {
            const name = m.name.toLowerCase();
            return name === normalizedConfigured || name.startsWith(`${normalizedConfigured}:`);
        });

        const ocrPatterns = ['deepseek-ocr', 'deepseek', 'minicpm', 'llava'];
        const found = isConfiguredPresent || models.some((m: { name: string }) =>
            ocrPatterns.some(pattern => m.name.toLowerCase().includes(pattern))
        );

        return NextResponse.json({
            available: found,
            model: configuredModel,
            message: found
                ? 'DeepSeek OCR 2 ready'
                : `OCR model not available. Run: ollama pull ${configuredModel}`
        });
    } catch (err) {
        console.error('[OCR Check] Error:', err);
        return NextResponse.json({
            available: false,
            model: 'deepseek-ocr',
            message: 'Check failed'
        });
    }
}
