import fs from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';

const lines = JSON.parse(fs.readFileSync(0, 'utf8'));
const document = await PDFDocument.create();
document.registerFontkit(fontkit);
const font = await document.embedFont(fs.readFileSync(new URL('./fonts/DejaVuSansMono.ttf', import.meta.url)), {
    features: { liga: false },
});
const supported = new Set(font.getCharacterSet());
const rowsPerPage = 52;
for (let offset = 0; offset < lines.length; offset += rowsPerPage) {
    const page = document.addPage([595, 842]);
    for (const [row, line] of lines.slice(offset, offset + rowsPerPage).entries()) {
        if (!line) continue;
        if ([...line].some(character => !supported.has(character.codePointAt(0)))) throw Error('PDF_CHARACTER_UNSUPPORTED');
        page.drawText(line, { x: 32, y: 790 - 14 * row, size: 10, font });
    }
}
process.stdout.write(await document.save());
