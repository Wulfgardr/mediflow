import { diagnosticOperation, diagnosticAsyncOperation } from './diagnostic-operation';
import type { Page, TestInfo } from '@playwright/test';

export async function attachMeasuresPerDataGeometry(page: Page, testInfo: TestInfo): Promise<void> {
    const geometry = await diagnosticAsyncOperation('per-data.evaluate', () => page.evaluate(() => {
        const rect = (value: DOMRect) => ({ x: value.x, y: value.y, left: value.left, top: value.top,
            right: value.right, bottom: value.bottom, width: value.width, height: value.height });
        const styles = (element: Element) => {
            const css = getComputedStyle(element);
            return { tableLayout: css.tableLayout, padding: css.padding, paddingLeft: css.paddingLeft,
                paddingRight: css.paddingRight, boxSizing: css.boxSizing, font: css.font,
                fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight,
                letterSpacing: css.letterSpacing, textTransform: css.textTransform, whiteSpace: css.whiteSpace,
                overflowWrap: css.overflowWrap, wordBreak: css.wordBreak };
        };
        const box = (element: HTMLElement) => ({ rect: rect(element.getBoundingClientRect()),
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, computedStyle: styles(element) });
        const cell = (element: HTMLTableCellElement) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return { tag: element.tagName.toLowerCase(), text: element.textContent, ...box(element),
                contentRange: { rect: rect(range.getBoundingClientRect()),
                    clientRects: Array.from(range.getClientRects(), rect) } };
        };
        const section = document.querySelector<HTMLElement>('#parametri');
        const register = document.querySelector<HTMLElement>('[data-clinical-register="observations"]');
        const daySections = register ? Array.from(register.querySelectorAll<HTMLElement>('section')) : [];
        const tables = daySections.flatMap(day => Array.from(day.querySelectorAll<HTMLTableElement>(':scope > table')));
        return {
            schemaVersion: 1, sampledAtDocumentTimeMs: performance.now(),
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio,
                visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height,
                    scale: visualViewport.scale, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop } : null },
            theme: { classes: document.documentElement.className,
                surface: getComputedStyle(document.documentElement).getPropertyValue('--lume-surface-focal').trim() },
            fonts: { status: document.fonts.status, computedFontIsNotProofOfRenderedFace: true },
            section: section ? box(section) : null, register: register ? box(register) : null,
            daySectionCount: daySections.length, daySections: daySections.map(box), tableCount: tables.length,
            days: tables.map((table, index) => ({ index,
                section: table.parentElement ? box(table.parentElement) : null,
                heading: table.parentElement?.querySelector('h3')?.textContent ?? null,
                table: box(table), headers: Array.from(table.querySelectorAll('th'), cell),
                cells: Array.from(table.querySelectorAll('td'), cell) })),
        };
    }));
    const body = diagnosticOperation('per-data.produce', () => Buffer.from(JSON.stringify(geometry, null, 2)));
    await diagnosticAsyncOperation('per-data.attach', () => testInfo.attach('misure-per-data-320-geometria-prima-assert', {
        contentType: 'application/json', body,
    }));
}
