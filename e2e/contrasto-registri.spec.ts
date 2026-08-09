/* WUL-536. Falsificatore di contrasto sui due registri attivi.
   Nasce da un difetto reale: `--lume-signal-critical` e' register-independent e,
   usato grezzo come colore di testo, su grafite scendeva a 2.81:1 sull'etichetta
   «Zona Pericolo» di ogni pagina di impostazioni. Il rapporto e' calcolato sui
   valori COMPUTATI, non sul sorgente, perche' e' l'unico modo di intercettare un
   token che cambia significato al cambio di registro. */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const SUPERFICI = ['/settings', '/settings/aspetto', '/settings/ai', '/settings/backup', '/settings/accesso'] as const;
const REGISTRI = ['giorno', 'grafite'] as const;

type Reperto = { testo: string; rapporto: number; soglia: number; colore: string; sfondo: string; selettore: string };

async function setRegistro(page: Page, registro: (typeof REGISTRI)[number]): Promise<void> {
  await page.evaluate((value) => {
    const theme = value === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, registro);
}

/* Il calcolo gira nella pagina: serve lo sfondo EFFETTIVO, cioe' il primo
   antenato con un colore opaco, perche' le superfici Lume sono spesso
   trasparenti e il contrasto non si legge sul nodo di testo. */
async function repertiSottoSoglia(page: Page): Promise<Reperto[]> {
  return page.evaluate(() => {
    const sfondoEffettivo = (element: Element): string => {
      let corrente: Element | null = element;
      while (corrente) {
        const bg = getComputedStyle(corrente).backgroundColor;
        const match = bg.match(/rgba?\(([^)]+)\)/);
        if (match) {
          const parti = match[1].split(',').map((x) => parseFloat(x));
          if (parti.length < 4 || parti[3] > 0.95) return bg;
        }
        corrente = corrente.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };

    const luminanza = (colore: string): number | null => {
      const match = colore.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b] = match[1].split(',').map((x) => parseFloat(x) / 255);
      const canale = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b);
    };

    const descrivi = (element: Element): string => {
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      const classi = (element.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return `${element.tagName.toLowerCase()}${classi ? '.' + classi : ''}`;
    };

    const reperti: Reperto[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const stile = getComputedStyle(element);
      if (stile.visibility === 'hidden' || stile.display === 'none' || Number(stile.opacity) <= 0.05) continue;

      const testoDiretto = Array.from(element.childNodes)
        .filter((nodo) => nodo.nodeType === Node.TEXT_NODE && (nodo.textContent || '').trim().length > 1)
        .map((nodo) => (nodo.textContent || '').trim())
        .join(' ');
      if (!testoDiretto) continue;

      const sfondo = sfondoEffettivo(element);
      const lTesto = luminanza(stile.color);
      const lSfondo = luminanza(sfondo);
      if (lTesto === null || lSfondo === null) continue;

      const rapporto = (Math.max(lTesto, lSfondo) + 0.05) / (Math.min(lTesto, lSfondo) + 0.05);
      const px = parseFloat(stile.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(stile.fontWeight) >= 700);
      const soglia = grande ? 3 : 4.5;
      if (rapporto < soglia) {
        reperti.push({
          testo: testoDiretto.slice(0, 60),
          rapporto: Math.round(rapporto * 100) / 100,
          soglia,
          colore: stile.color,
          sfondo,
          selettore: descrivi(element),
        });
      }
    }
    return reperti;
  }) as Promise<Reperto[]>;
}

for (const registro of REGISTRI) {
  test(`contrasto WCAG AA sulle impostazioni — registro ${registro}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 960 });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await setRegistro(page, registro);

    for (const superficie of SUPERFICI) {
      await page.goto(superficie, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_200);
      await setRegistro(page, registro);
      await page.waitForTimeout(250);

      /* Ancora del difetto originale: se l'etichetta sparisce, il test smette di
         sorvegliare cio' per cui e' nato e va aggiornato invece di restare verde. */
      expect(
        await page.getByText('Zona Pericolo').count(),
        `${superficie}: l'etichetta «Zona Pericolo» deve essere presente`,
      ).toBeGreaterThan(0);

      const reperti = await repertiSottoSoglia(page);
      expect(
        reperti,
        `${superficie} (${registro}) sotto soglia WCAG AA:\n${reperti
          .map((r) => `  ${r.rapporto}:1 (min ${r.soglia}) ${r.selettore} "${r.testo}" — ${r.colore} su ${r.sfondo}`)
          .join('\n')}`,
      ).toEqual([]);
    }
  });
}
