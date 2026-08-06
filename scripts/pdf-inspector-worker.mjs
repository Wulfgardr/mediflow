const chunks = [];
const MAX_PAGES = 500;
for await (const chunk of process.stdin) chunks.push(chunk);

function buildPageText(items) {
  const positioned = items
    .map((item) => ({
      text: typeof item?.str === 'string' ? item.str.trim() : '',
      x: Array.isArray(item?.transform) ? Number(item.transform[4]) || 0 : 0,
      y: Array.isArray(item?.transform) ? Number(item.transform[5]) || 0 : 0,
    }))
    .filter((item) => item.text)
    .sort((left, right) => Math.abs(right.y - left.y) > 3 ? right.y - left.y : left.x - right.x);
  const lines = [];
  for (const item of positioned) {
    const line = lines.at(-1);
    if (!line || Math.abs(line.y - item.y) > 3) {
      lines.push({ y: item.y, parts: [item] });
    } else {
      line.parts.push(item);
    }
  }
  return lines
    .map((line) => line.parts
      .sort((left, right) => left.x - right.x)
      .map((part) => part.text)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim())
    .filter(Boolean)
    .join('\n');
}

try {
  const data = Buffer.concat(chunks);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const preflightDocument = await pdfjs.getDocument({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    disableWorker: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  if (preflightDocument.numPages > MAX_PAGES) {
    const limitError = new Error('page limit');
    limitError.name = 'ResourceLimitError';
    throw limitError;
  }
  let pages;
  const usePdfJsFallback = (process.platform === 'darwin' && process.arch === 'x64')
    || process.argv.includes('--pdfjs-fallback');
  if (usePdfJsFallback) {
    const document = preflightDocument;
    pages = [];
    for (let index = 0; index < document.numPages; index += 1) {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      const text = buildPageText(content.items);
      const operators = await page.getOperatorList();
      const pageArea = Math.abs((page.view[2] - page.view[0]) * (page.view[3] - page.view[1]));
      const areaStack = [];
      const coverageImageOperators = [
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
      ];
      const conservativeImageOperators = [
        pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.paintImageMaskXObjectGroup,
        pdfjs.OPS.paintInlineImageXObjectGroup,
        pdfjs.OPS.paintImageXObjectRepeat,
        pdfjs.OPS.paintImageMaskXObjectRepeat,
        pdfjs.OPS.paintSolidColorImageMask,
      ];
      let transformedArea = 1;
      let hasFullPageImage = false;
      let hasConservativeImage = false;
      let hasVisualContent = false;
      for (let operatorIndex = 0; operatorIndex < operators.fnArray.length; operatorIndex += 1) {
        const operator = operators.fnArray[operatorIndex];
        if (operator === pdfjs.OPS.save) {
          areaStack.push(transformedArea);
        } else if (operator === pdfjs.OPS.restore) {
          transformedArea = areaStack.pop() ?? 1;
        } else if (operator === pdfjs.OPS.transform) {
          const [a, b, c, d] = operators.argsArray[operatorIndex];
          transformedArea *= Math.abs((a * d) - (b * c));
        } else if (coverageImageOperators.includes(operator)) {
          hasVisualContent = true;
          if (transformedArea >= pageArea * 0.5) hasFullPageImage = true;
        } else if (conservativeImageOperators.includes(operator)) {
          hasVisualContent = true;
          hasConservativeImage = true;
        } else if ([
          pdfjs.OPS.constructPath,
          pdfjs.OPS.stroke,
          pdfjs.OPS.fill,
          pdfjs.OPS.eoFill,
          pdfjs.OPS.fillStroke,
          pdfjs.OPS.eoFillStroke,
          pdfjs.OPS.shadingFill,
        ].includes(operator)) {
          hasVisualContent = true;
        }
      }
      const compact = text.replace(/\s+/gu, ' ').trim();
      const alphaCount = compact.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/gu)?.length || 0;
      const uniqueTokens = new Set(compact.toLowerCase().split(/\s+/gu).filter(Boolean));
      const hasUsableText = compact.length >= 24 && alphaCount >= 12 && uniqueTokens.size >= 3;
      const hasReadableShortText = compact.length > 0
        && compact.length < 24
        && alphaCount >= Math.ceil(compact.length * 0.5);
      const needsOcr = hasFullPageImage
        || hasConservativeImage
        || (!compact && hasVisualContent)
        || (compact.length > 0 && !hasUsableText && !hasReadableShortText);
      pages.push({ pageIndex: index, markdown: text, needsOcr });
    }
  } else {
    await preflightDocument.destroy();
    const { extractPagesMarkdown } = await import('@firecrawl/pdf-inspector');
    const result = await extractPagesMarkdown(data);
    pages = result.pages.map((page) => ({
      pageIndex: page.page,
      markdown: page.markdown,
      needsOcr: page.needsOcr,
    }));
  }
  process.stdout.write(JSON.stringify({ schema: 'mediflow.pdf-inspection.v1', pages }));
} catch (error) {
  const message = String(error?.message || '').toLowerCase();
  const errorName = String(error?.name || '');
  const reason = errorName === 'PasswordException'
    || message.includes('password')
    || message.includes('encrypted')
    ? 'password_protected'
    : errorName === 'ResourceLimitError'
      ? 'resource_limit'
    : message.includes('invalid') || message.includes('corrupt')
      ? 'corrupted_pdf'
      : 'parser_failed';
  process.stdout.write(JSON.stringify({ schema: 'mediflow.pdf-inspection.v1', error: reason }));
  process.exitCode = 2;
}
