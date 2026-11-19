const paintedOutsideText = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke',
    'shadingFill', 'beginInlineImage', 'beginAnnotation', 'paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageXObject',
    'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask'] as const;
export type PdfOperatorCodes = Record<(typeof paintedOutsideText)[number], number>;

export function pdfPagePaintsBeyondText(codes: PdfOperatorCodes, operators: { fnArray: readonly number[] }, annotations: readonly unknown[]): boolean {
    const outside = new Set(paintedOutsideText.map(name => codes[name]));
    return annotations.length > 0 || operators.fnArray.some(operator => outside.has(operator));
}
