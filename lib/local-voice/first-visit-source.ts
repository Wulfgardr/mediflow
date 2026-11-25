const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 11;
const LEADING = 15;

/** The reviewed text of a first visit as a PDF source for the document engine that proposes the new sheet. */
export async function firstVisitSource(text: string, day: Date): Promise<File> {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const encodable = new Map<string, boolean>();
    const safe = (value: string) => [...value].map((character) => {
        let known = encodable.get(character);
        if (known === undefined) {
            try { font.encodeText(character); known = true; } catch { known = false; }
            encodable.set(character, known);
        }
        return known ? character : '?';
    }).join('');
    const width = PAGE[0] - MARGIN * 2;
    const lines: string[] = [];
    const label = day.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    for (const paragraph of [`Prima visita del ${label}, testo registrato e rivisto dal medico.`, '', ...text.replace(/\r\n?/gu, '\n').split('\n')]) {
        let line = '';
        for (const word of safe(paragraph).split(/\s+/u).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (line && font.widthOfTextAtSize(next, SIZE) > width) { lines.push(line); line = word; } else line = next;
        }
        lines.push(line);
    }
    const perPage = Math.floor((PAGE[1] - MARGIN * 2) / LEADING);
    for (let start = 0; start < lines.length; start += perPage) {
        const page = pdf.addPage(PAGE);
        lines.slice(start, start + perPage).forEach((line, index) => {
            if (line) page.drawText(line, { x: MARGIN, y: PAGE[1] - MARGIN - SIZE - index * LEADING, size: SIZE, font });
        });
    }
    const bytes = await pdf.save();
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return new File([bytes as BlobPart], `prima-visita-${iso}.pdf`, { type: 'application/pdf' });
}
