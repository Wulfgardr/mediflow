import { expect, type Locator } from '@playwright/test';

export const voiceServiceDeclared = () => process.env.E2E_LOCAL_VOICE_CONFIGURED === '1';

export const headerCommandNames = (voice: boolean) => voice
    ? ['Prescrivi', 'Registra la visita', 'Nuova voce', 'Azioni']
    : ['Prescrivi', 'Nuova voce', 'Azioni'];

export const headerCommands = (header: Locator) => header.locator('a:visible,button:visible,summary:visible');

export async function expectHeaderCommands(header: Locator, voice: boolean) {
    await expect.poll(() => headerCommands(header).evaluateAll((elements) => elements
        .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''))).toEqual(headerCommandNames(voice));
    await expect(header.getByRole('link', { name: 'Registra la visita', exact: true })).toHaveCount(voice ? 1 : 0);
}

export async function expectHeaderCommandsLaidOut(header: Locator) {
    const controls = await headerCommands(header).evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const lines: number[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            lines.push(range.getClientRects().length);
        }
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { name: element.textContent?.trim() ?? '', box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
            lines, clipped: element.scrollWidth > element.clientWidth + 1, reachable: Boolean(hit && element.contains(hit)),
            viewport: document.documentElement.clientWidth };
    }));
    for (const control of controls) {
        expect(control.lines, `${control.name}: etichetta su una riga`).toEqual(control.lines.map(() => 1));
        expect(control.clipped, `${control.name}: etichetta intera`).toBe(false);
        expect(control.reachable, `${control.name}: non coperto`).toBe(true);
        expect(control.box.x, `${control.name}: dentro la pagina`).toBeGreaterThanOrEqual(0);
        expect(control.box.right, `${control.name}: dentro la pagina`).toBeLessThanOrEqual(control.viewport);
    }
    for (const [index, a] of controls.entries()) for (const b of controls.slice(index + 1)) {
        const apart = a.box.right <= b.box.x + 0.5 || b.box.right <= a.box.x + 0.5 || a.box.bottom <= b.box.y + 0.5 || b.box.bottom <= a.box.y + 0.5;
        expect(apart, `${a.name} e ${b.name} non si sovrappongono`).toBe(true);
    }
}
