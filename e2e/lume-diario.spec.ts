/* @Codex issue 105, riferimento 68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type DiaryCase = {
  register: 'giorno' | 'grafite';
  viewport: 'wide' | 'narrow';
  width: number;
  height: number;
};

const DIARY_CASES: DiaryCase[] = [
  { register: 'giorno', viewport: 'wide', width: 1440, height: 960 },
  { register: 'grafite', viewport: 'wide', width: 1440, height: 960 },
  { register: 'giorno', viewport: 'narrow', width: 390, height: 844 },
  { register: 'grafite', viewport: 'narrow', width: 390, height: 844 },
];

const FIXTURE_PREFIX = 'Diario Filo sintetico';

async function createPatient(page: Page): Promise<string> {
  const marker = Date.now().toString().slice(-8);
  return page.evaluate(async ({ marker: suffix }) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Filo${suffix}`,
        lastName: `Sintetico${suffix}`,
        taxCode: `FLO${suffix.padStart(13, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico',
        phone: '0000000105',
        diagnoses: [],
      }),
    });
    if (!response.ok) throw new Error(`Creazione paziente diario fallita: ${response.status}`);
    return (await response.json() as { id: string }).id;
  }, { marker });
}

async function createEntry(
  page: Page,
  patientId: string,
  fixture: { title: string; date: string; status: 'draft' | 'signed'; source: string; author?: string },
): Promise<void> {
  await page.evaluate(async ({ patientId: id, fixture: entry }) => {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: id,
        type: entry.status === 'draft' ? 'note' : 'visit',
        title: entry.title,
        content: `Contenuto ${entry.title.toLocaleLowerCase('it-IT')}, esclusivamente sintetico.`,
        date: entry.date,
        setting: 'ambulatory',
        metadata: {
          workflowStatus: entry.status,
          sourceLabel: entry.source,
          authorName: entry.author,
        },
      }),
    });
    if (!response.ok) throw new Error(`Creazione voce diario fallita: ${response.status}`);
  }, { patientId, fixture });
}

async function createSequence(page: Page): Promise<void> {
  const patientId = await createPatient(page);
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 1`,
    date: '2026-07-14T08:15:00.000Z',
    status: 'signed',
    source: 'Ambulatorio sintetico',
    author: 'Dr.ssa Demo',
  });
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 2`,
    date: '2026-07-15T10:30:00.000Z',
    status: 'signed',
    source: 'Referto sintetico',
  });
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 3`,
    date: '2026-07-16T09:40:00.000Z',
    status: 'draft',
    source: 'Dettatura sintetica',
    author: 'Dr.ssa Demo',
  });
}

async function ensureSequence(page: Page): Promise<void> {
  const exists = await page.evaluate(async (prefix) => {
    const response = await fetch('/api/entries?limit=50&orderBy=date&orderDir=desc');
    if (!response.ok) return false;
    const entries = await response.json() as Array<{ title?: string }>;
    return entries.some((entry) => entry.title?.startsWith(prefix));
  }, FIXTURE_PREFIX);
  if (!exists) await createSequence(page);
}

async function setRegister(page: Page, register: DiaryCase['register']): Promise<void> {
  await page.evaluate((nextRegister) => {
    const theme = nextRegister === 'grafite' ? 'dark' : 'light';
    localStorage.setItem('mediflow-theme', theme);
  }, register);
}

async function openDiary(page: Page, diaryCase?: DiaryCase): Promise<Locator> {
  if (diaryCase) await page.setViewportSize({ width: diaryCase.width, height: diaryCase.height });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await ensureSequence(page);
  if (diaryCase) await setRegister(page, diaryCase.register);
  await page.goto('/diary');
  await page.waitForLoadState('domcontentloaded');
  const diary = page.getByTestId('lume-diario');
  await expect(diary).toBeVisible();
  await expect(diary.getByTestId('lume-diario-entry')).toHaveCount(3);
  return diary;
}

async function resolvedRegisterFamily(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'lume-registro';
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  });
}

async function assertNoSideStripe(diary: Locator, entries: Locator): Promise<void> {
  const connector = diary.locator('svg[data-lume-filo="spina"]');
  await expect(connector).toHaveCount(1);
  await expect(connector.locator('line, path')).toHaveCount(1);
  const entryCount = await entries.count();
  await expect(entries.locator('svg[data-lume-filo-node="true"] > circle')).toHaveCount(entryCount);
  for (let index = 0; index < entryCount; index += 1) {
    await expect(entries.nth(index).locator('svg[data-lume-filo-node="true"] > circle')).toHaveCount(1);
  }

  const borders = await entries.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return {
      leftWidth: style.borderLeftWidth,
      topWidth: style.borderTopWidth,
      leftStyle: style.borderLeftStyle,
      topStyle: style.borderTopStyle,
      leftColor: style.borderLeftColor,
      topColor: style.borderTopColor,
      pseudoElements: ['::before', '::after'].map((pseudoElement) => {
        const pseudoStyle = getComputedStyle(element, pseudoElement);
        return {
          pseudoElement,
          content: pseudoStyle.content,
          leftStyle: pseudoStyle.borderLeftStyle,
          leftWidth: pseudoStyle.borderLeftWidth,
          rightStyle: pseudoStyle.borderRightStyle,
          rightWidth: pseudoStyle.borderRightWidth,
        };
      }),
    };
  }));
  for (const border of borders) {
    expect(border.leftWidth).toBe(border.topWidth);
    expect(border.leftStyle).toBe(border.topStyle);
    expect(border.leftColor).toBe(border.topColor);
    for (const pseudoElement of border.pseudoElements) {
      expect(
        pseudoElement.leftStyle !== 'none' && Number.parseFloat(pseudoElement.leftWidth) > 0,
        `${pseudoElement.pseudoElement} non deve disegnare un bordo verticale sinistro`,
      ).toBe(false);
      expect(
        pseudoElement.rightStyle !== 'none' && Number.parseFloat(pseudoElement.rightWidth) > 0,
        `${pseudoElement.pseudoElement} non deve disegnare un bordo verticale destro`,
      ).toBe(false);
    }
  }
}

async function assertContrastAndFocus(
  page: Page,
  entries: Locator,
  register: DiaryCase['register'],
): Promise<void> {
  const ratios = await page.evaluate(() => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (value: string) => {
      const [red, green, blue] = parse(value).map(channel);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const ratio = (foreground: string, background: string) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    const draft = document.querySelector<HTMLElement>('[data-lume-entry-state="draft"]');
    const signed = document.querySelector<HTMLElement>('[data-lume-entry-state="signed"]');
    if (!draft || !signed) return null;
    const draftText = draft.querySelector<HTMLElement>('p');
    const signedText = signed.querySelector<HTMLElement>('p');
    if (!draftText || !signedText) return null;
    return {
      draft: ratio(getComputedStyle(draftText).color, getComputedStyle(draft).backgroundColor),
      signed: ratio(getComputedStyle(signedText).color, getComputedStyle(signed).backgroundColor),
    };
  });
  expect(ratios).not.toBeNull();
  expect(ratios!.draft, `Contrasto bozza nel registro ${register}`).toBeGreaterThanOrEqual(4.5);
  expect(ratios!.signed, `Gerarchia inchiostro nel registro ${register}`).toBeGreaterThan(ratios!.draft);

  await expect(entries.filter({ hasText: `${FIXTURE_PREFIX} 3` })).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-testid="lume-diario-entry"][data-active="true"]')).toHaveCount(1);
  const shadows = await entries.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).boxShadow));
  expect(shadows[0]).not.toBe('none');
  expect(shadows.slice(1).every((shadow) => shadow === 'none')).toBe(true);
}

async function assertNarrowLayout(page: Page, diary: Locator): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    diary: document.querySelector<HTMLElement>('[data-testid="lume-diario"]')
      ? document.querySelector<HTMLElement>('[data-testid="lume-diario"]')!.scrollWidth
        - document.querySelector<HTMLElement>('[data-testid="lume-diario"]')!.clientWidth
      : Number.POSITIVE_INFINITY,
  }));
  for (const [surface, delta] of Object.entries(overflow)) {
    expect(delta, `Overflow orizzontale su ${surface}`).toBeLessThanOrEqual(1);
  }

  const geometry = await diary.getByTestId('lume-diario-entry').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const date = element.querySelector<HTMLElement>('[data-lume-entry-part="date"]')!.getBoundingClientRect();
    const provenance = element.querySelector<HTMLElement>('[data-lume-entry-part="provenance"]')!.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, dateBottom: date.bottom, provenanceTop: provenance.top };
  }));
  for (let index = 1; index < geometry.length; index += 1) {
    expect(geometry[index].top).toBeGreaterThanOrEqual(geometry[index - 1].bottom - 1);
  }
  expect(geometry.every((entry) => entry.dateBottom <= entry.provenanceTop)).toBe(true);
}

test.describe.serial('Diario globale Lume', () => {
  test('Filo assente con zero o una voce, unico con una sequenza reale', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    await page.goto('/diary');
    const diary = page.getByTestId('lume-diario');
    await expect(diary).toContainText('Nessuna voce clinica nel diario locale.');
    await expect(diary.locator('[data-lume-filo="spina"]')).toHaveCount(0);

    const patientId = await createPatient(page);
    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 1`,
      date: '2026-07-14T08:15:00.000Z',
      status: 'signed',
      source: 'Ambulatorio sintetico',
      author: 'Dr.ssa Demo',
    });
    await page.reload();
    await expect(diary.getByTestId('lume-diario-entry')).toHaveCount(1);
    await expect(diary.locator('[data-lume-filo="spina"]')).toHaveCount(0);

    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 2`,
      date: '2026-07-15T10:30:00.000Z',
      status: 'signed',
      source: 'Referto sintetico',
    });
    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 3`,
      date: '2026-07-16T09:40:00.000Z',
      status: 'draft',
      source: 'Dettatura sintetica',
      author: 'Dr.ssa Demo',
    });
    await page.reload();

    const entries = diary.getByTestId('lume-diario-entry');
    const feed = page.getByRole('feed', { name: 'Diario clinico globale' });
    await expect(feed).toBeVisible();
    await expect(entries).toHaveCount(3);
    await expect(diary.locator('[data-lume-filo="spina"]')).toHaveCount(1);
    await expect(diary.locator('[data-lume-filo="spina"]')).toHaveAttribute('data-lume-filo-node-count', '3');
    await expect(diary.locator('[data-lume-diary-node]')).toHaveCount(3);
    await expect(entries.first()).toContainText('Bozza');
    await expect(entries.first()).toContainText('Fonte: Dettatura sintetica');
    await expect(entries.first()).toContainText('Autore: Dr.ssa Demo');
    await assertNoSideStripe(diary, entries);

    const registerFamily = await resolvedRegisterFamily(page);
    const metaFamilies = await diary.locator('[data-lume-entry-part="date"], [data-lume-entry-part="provenance"]').evaluateAll(
      (elements) => elements.map((element) => getComputedStyle(element).fontFamily),
    );
    expect(new Set(metaFamilies)).toEqual(new Set([registerFamily]));
    await assertContrastAndFocus(page, entries, 'giorno');

    await page.getByRole('button', { name: 'Apri quadro', exact: true }).first().focus();
    await page.keyboard.press('Tab');
    await expect(entries.first()).toBeFocused();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await page.evaluate(() => {
      const entry = document.querySelector<HTMLElement>('[data-testid="lume-diario-entry"]');
      const filo = document.querySelector<SVGElement>('[data-lume-filo="spina"]');
      return {
        entry: entry ? getComputedStyle(entry).transitionDuration : 'missing',
        filo: filo ? getComputedStyle(filo).transitionDuration : 'missing',
      };
    });
    expect(motion).toEqual({ entry: '0s', filo: '0s' });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.setAttribute('data-ui-reduce-motion', 'true'));
    const uiReducedMotion = await page.evaluate(() => {
      const entry = document.querySelector<HTMLElement>('[data-testid="lume-diario-entry"]');
      const filo = document.querySelector<SVGElement>('[data-lume-filo="spina"]');
      return {
        entry: entry ? getComputedStyle(entry).transitionDuration : 'missing',
        filo: filo ? getComputedStyle(filo).transitionDuration : 'missing',
      };
    });
    for (const [element, duration] of Object.entries(uiReducedMotion)) {
      expect(
        Number.parseFloat(duration) * 1000,
        `Durata ${element} con data-ui-reduce-motion`,
      ).toBeLessThanOrEqual(0.01);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-ui-reduce-motion'));
  });

  for (const diaryCase of DIARY_CASES) {
    test(`diario Lume ${diaryCase.register} ${diaryCase.viewport}`, async ({ page }) => {
      const diary = await openDiary(page, diaryCase);
      await expect(page.locator('html')).toHaveClass(diaryCase.register === 'grafite' ? /dark/ : /light/);
      await expect(diary.locator('[data-lume-filo="spina"]')).toHaveCount(1);
      const entries = diary.getByTestId('lume-diario-entry');
      await assertNoSideStripe(diary, entries);
      await assertContrastAndFocus(page, entries, diaryCase.register);
      if (diaryCase.viewport === 'narrow') await assertNarrowLayout(page, diary);
      await diary.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `/tmp/lume-diario-${diaryCase.register}-${diaryCase.viewport}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
});
