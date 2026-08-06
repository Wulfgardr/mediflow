/* @Codex */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PDF_INSPECTOR_MAX_BYTES = 25 * 1024 * 1024;
const PDF_INSPECTOR_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const PDF_INSPECTOR_TIMEOUT_MS = 30_000;
const PDF_INSPECTOR_MAX_PAGES = 500;
const PDF_INSPECTOR_MAX_CONCURRENCY = 2;
const PDF_INSPECTOR_MAX_RESIDENT_BYTES = 512 * 1024 * 1024;
let activePdfInspections = 0;

export type PdfInspectionFailureReason =
    | 'password_protected'
    | 'corrupted_pdf'
    | 'parser_failed'
    | 'resource_limit';

export class PdfInspectionError extends Error {
    readonly reason: PdfInspectionFailureReason;

    constructor(reason: PdfInspectionFailureReason) {
        super('PDF inspection unavailable');
        this.name = 'PdfInspectionError';
        this.reason = reason;
    }
}

export interface PdfInspection {
    text: string;
    pageCount: number;
    pagesNeedingOcr: number[];
    state: 'native' | 'mixed' | 'ocr_required';
    pages: Array<{ page: number; text: string; needsOcr: boolean }>;
}

interface WorkerPage {
    pageIndex: number;
    markdown: string;
    needsOcr: boolean;
}

export function normalizePdfInspection(pages: WorkerPage[]): PdfInspection {
    if (
        pages.length === 0
        || pages.some((page, index) => (
            page.pageIndex !== index
            || typeof page.markdown !== 'string'
            || typeof page.needsOcr !== 'boolean'
        ))
    ) {
        throw new PdfInspectionError('parser_failed');
    }
    if (pages.length > PDF_INSPECTOR_MAX_PAGES) {
        throw new PdfInspectionError('resource_limit');
    }

    const pagesNeedingOcr = pages
        .filter((page) => page.needsOcr)
        .map((page) => page.pageIndex + 1);
    const text = pages
        .filter((page) => !page.needsOcr && page.markdown.trim())
        .map((page) => page.markdown.trim())
        .join('\n\n');
    const state = pagesNeedingOcr.length === 0
        ? 'native'
        : pagesNeedingOcr.length === pages.length
            ? 'ocr_required'
            : 'mixed';

    return {
        text,
        pageCount: pages.length,
        pagesNeedingOcr,
        state,
        pages: pages.map((page) => ({
            page: page.pageIndex + 1,
            text: page.needsOcr ? '' : page.markdown.trim(),
            needsOcr: page.needsOcr,
        })),
    };
}

export async function inspectPdf(buffer: Buffer): Promise<PdfInspection> {
    if (buffer.length === 0 || buffer.length > PDF_INSPECTOR_MAX_BYTES) {
        throw new PdfInspectionError('resource_limit');
    }
    if (activePdfInspections >= PDF_INSPECTOR_MAX_CONCURRENCY) {
        throw new PdfInspectionError('resource_limit');
    }
    activePdfInspections += 1;

    const worker = join(process.cwd(), 'scripts', 'pdf-inspector-worker.mjs');
    try {
        return await new Promise<PdfInspection>((resolve, reject) => {
            const child = spawn(process.execPath, ['--max-old-space-size=512', worker], {
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
            });
            const output: Buffer[] = [];
            let outputSize = 0;
            let settled = false;
            let memoryProbeActive = false;
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(memoryTimer);
                callback();
            };
            const timer = setTimeout(() => {
                child.kill();
                finish(() => reject(new PdfInspectionError('resource_limit')));
            }, PDF_INSPECTOR_TIMEOUT_MS);
            const probeResidentMemory = () => {
                if (settled || memoryProbeActive || child.pid === undefined) return;
                memoryProbeActive = true;
                if (process.platform === 'linux') {
                    void readFile(`/proc/${child.pid}/status`, 'utf8')
                        .then((status) => {
                            memoryProbeActive = false;
                            if (settled || child.exitCode !== null) return;
                            const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu);
                            const residentBytes = match ? Number.parseInt(match[1], 10) * 1024 : Number.NaN;
                            if (!Number.isFinite(residentBytes) || residentBytes > PDF_INSPECTOR_MAX_RESIDENT_BYTES) {
                                child.kill();
                                finish(() => reject(new PdfInspectionError('resource_limit')));
                            }
                        })
                        .catch(() => {
                            memoryProbeActive = false;
                            if (settled || child.exitCode !== null) return;
                            child.kill();
                            finish(() => reject(new PdfInspectionError('resource_limit')));
                        });
                    return;
                }
                const command = process.platform === 'win32' ? 'powershell.exe' : '/bin/ps';
                const args = process.platform === 'win32'
                    ? ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${child.pid}).WorkingSet64`]
                    : ['-o', 'rss=', '-p', String(child.pid)];
                const probe = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
                let sample = '';
                probe.stdout.on('data', (chunk: Buffer) => {
                    sample += chunk.toString('ascii');
                    if (sample.length > 64) probe.kill();
                });
                probe.once('close', (code) => {
                    memoryProbeActive = false;
                    if (settled || child.exitCode !== null) return;
                    const raw = Number.parseInt(sample.trim(), 10);
                    const residentBytes = process.platform === 'win32' ? raw : raw * 1024;
                    if (code !== 0 || !Number.isFinite(residentBytes) || residentBytes > PDF_INSPECTOR_MAX_RESIDENT_BYTES) {
                        child.kill();
                        finish(() => reject(new PdfInspectionError('resource_limit')));
                    }
                });
                probe.once('error', () => {
                    memoryProbeActive = false;
                    if (settled || child.exitCode !== null) return;
                    child.kill();
                    finish(() => reject(new PdfInspectionError('resource_limit')));
                });
            };
            const memoryTimer = setInterval(probeResidentMemory, 200);
            probeResidentMemory();

            child.stdout.on('data', (chunk: Buffer) => {
                outputSize += chunk.length;
                if (outputSize > PDF_INSPECTOR_MAX_OUTPUT_BYTES) {
                    child.kill();
                    finish(() => reject(new PdfInspectionError('resource_limit')));
                    return;
                }
                output.push(chunk);
            });
            child.once('error', () => finish(() => reject(new PdfInspectionError('parser_failed'))));
            child.stdin.once('error', () => finish(() => reject(new PdfInspectionError('parser_failed'))));
            child.once('close', () => finish(() => {
                try {
                    const payload = JSON.parse(Buffer.concat(output).toString('utf8'));
                    if (payload?.error) throw new PdfInspectionError(payload.error);
                    if (payload?.schema !== 'mediflow.pdf-inspection.v1' || !Array.isArray(payload.pages)) {
                        throw new PdfInspectionError('parser_failed');
                    }
                    resolve(normalizePdfInspection(payload.pages));
                } catch (error) {
                    reject(error instanceof PdfInspectionError ? error : new PdfInspectionError('parser_failed'));
                }
            }));
            child.stdin.end(buffer);
        });
    } finally {
        activePdfInspections -= 1;
    }
}
