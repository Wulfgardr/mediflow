/** A one-page PDF with an uncompressed comment stream and correct xref offsets. Synthetic only. */
export function createSyntheticPdf(byteLength: number): Buffer {
    const render = (padding: number) => {
        const stream = `BT /F1 12 Tf 40 700 Td (Nome: Mario Rossi - documento sintetico) Tj ET\n%${'x'.repeat(padding)}\n`;
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
        ];
        let text = '%PDF-1.4\n', offsets = '';
        for (let index = 0; index < objects.length; index += 1) {
            offsets += `${text.length.toString().padStart(10, '0')} 00000 n \n`;
            text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
        }
        return Buffer.from(`${text}xref\n0 6\n0000000000 65535 f \n${offsets}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${text.length}\n%%EOF\n`);
    };
    let padding = byteLength - render(0).length;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const pdf = render(padding);
        if (pdf.length === byteLength) return pdf;
        padding += byteLength - pdf.length;
    }
    throw new Error('Invalid synthetic PDF size');
}
