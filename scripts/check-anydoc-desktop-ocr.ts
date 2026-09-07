/* @Codex */
import { inspectAnyDocDesktopOcrCapability } from '../lib/domain/documents/anydoc-pdf-child-process-owner';
import { extractAnyDocLocalBytes } from '../lib/domain/documents/anydoc-local-extraction-runner';

const expected = 'MEDIFLOW SYNTHETIC PREFLIGHT';

// Construct a fixed, native-text PDF without loading PDF engines into this process.
function syntheticNativePdf(): Buffer {
    const stream = `BT /F1 16 Tf 25 80 Td (${expected}) Tj ET\n`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
        const offset = Buffer.byteLength(pdf);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    return Buffer.from(`${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function main() {
    const capability = inspectAnyDocDesktopOcrCapability({
        developmentSmoke: process.argv.includes('--development-tesseract-smoke'),
    });
    if (capability.status !== 'artifacts_verified') return { ...capability, anydocFirstPass: 'not_checked' };
    const initial = await extractAnyDocLocalBytes('synthetic.desktop.preflight', syntheticNativePdf());
    // AnyDoc may represent the uppercase marker as a Markdown heading.
    if (initial.status !== 'extracted' || !initial.markdown.includes(expected)) {
        return { ...capability, status: 'unavailable', reason: 'anydoc_unavailable', anydocFirstPass: 'failed',
            guidance: 'Verificare il binding locale @firecrawl/anydoc@0.2.4 per OS/arch e le sue librerie native. Su Windows verificare anche il runtime Microsoft Visual C++ x64 (VCRUNTIME140.dll). Ripetere il controllo dopo provisioning autorizzato; nessuna installazione automatica.' };
    }
    return { ...capability, anydocFirstPass: 'verified' };
}

void main().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    // Exit zero attests artifact integrity and synthetic AnyDoc extraction, never OCR qualification.
    process.exitCode = result.status === 'not_applicable' ? 2 : result.status === 'artifacts_verified' ? 0 : 1;
});
