import { NextRequest, NextResponse } from 'next/server';
import { extractDocumentWithAI } from '@/lib/ocr-service';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { inArray } from 'drizzle-orm';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';

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

        const result = await extractDocumentWithAI(image, mode);

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
        const rows = await dbServer
            .select()
            .from(settings)
            .where(inArray(settings.key, ['aiUrl', 'ollamaUrl', 'aiModel_ocr']));

        const getValue = (key: string) => rows.find(row => row.key === key)?.value || null;
        const configuredUrl = getValue('aiUrl') || getValue('ollamaUrl');
        const configuredModel = getValue('aiModel_ocr') || 'deepseek-ocr';

        const baseUrl = (configuredUrl || 'http://127.0.0.1:11434')
            .replace(/\/v1\/?$/, '')
            .replace(/\/$/, '');

        const res = await fetch(`${baseUrl}/api/tags`);
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
