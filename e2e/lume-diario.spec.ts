/* @Codex issue 105, riferimento 68 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertKeyboardFocusProgresses,
  assertNoHorizontalOverflow,
  assertNotClippedInViewport,
  bootstrapUnlockedSession,
  REFLOW_PROXY_VIEWPORTS,
  type ReflowProxyViewport,
} from './utils';

type DiaryCase = {
  register: 'giorno' | 'grafite';
  viewport: ReflowProxyViewport['viewport'];
  width: number;
  height: number;
};

const DIARY_CASES: DiaryCase[] = (['giorno', 'grafite'] as const).flatMap((register) =>
  REFLOW_PROXY_VIEWPORTS.map((viewport) => ({ register, ...viewport })),
);

const FIXTURE_PREFIX = 'Diario Filo sintetico';
const createdPatientIds: string[] = [];

async function createPatient(page: Page): Promise<string> {
  const marker = Date.now().toString().slice(-8);
  const patientId = await page.evaluate(async ({ marker: suffix }) => {
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
  createdPatientIds.push(patientId);
  return patientId;
}

/* @Codex The global diary lists non-deleted entries independently from the
   patient list. Delete only this spec's entries before their patients; unrelated diary rows stay intact. */
async function cleanupCreatedPatients(page: Page): Promise<void> {
  for (const patientId of createdPatientIds.splice(0).reverse()) {
    const entriesResponse = await page.evaluate(async (id) => {
      const response = await fetch(`/api/entries?patientId=${encodeURIComponent(id)}&includeDeleted=true`);
      if (!response.ok) throw new Error(`Lettura cleanup diario fallita: ${response.status}`);
      return await response.json() as Array<{ id: string; version: number; deletedAt?: string | null }>;
    }, patientId);

    for (const entry of entriesResponse.filter((candidate) => !candidate.deletedAt)) {
      await page.evaluate(async (candidate) => {
        const response = await fetch(`/api/entries/${encodeURIComponent(candidate.id)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: candidate.version }),
        });
        if (!response.ok) throw new Error(`Cleanup voce diario fallito: ${response.status}`);
      }, entry);
    }

    const patient = await page.evaluate(async (id) => {
      const response = await fetch(`/api/patients/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(`Lettura cleanup paziente fallita: ${response.status}`);
      return await response.json() as { version: number };
    }, patientId);
    await page.evaluate(async ({ id, version }) => {
      const response = await fetch(`/api/patients/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!response.ok) throw new Error(`Cleanup paziente diario fallito: ${response.status}`);
    }, { id: patientId, version: patient.version });
  }
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

/* @Codex: a full collector can already contain other patients/scales.
   Capture the ordinary global window and keep every row still within its
   50-entry limit. New fixture dates follow that window, without changing clocks. */
type DiaryBaseline = { signatures: string[]; nextDate: number };

async function readGlobalWindow(page: Page): Promise<Array<{ date: string }>> {
  const response = await page.request.get('/api/entries?limit=50&orderBy=date&orderDir=desc');
  expect(response.status()).toBe(200);
  return response.json();
}

async function diarySignatures(entries: Locator): Promise<string[]> {
  return entries.evaluateAll((elements) => elements.map((element) => JSON.stringify([
    element.querySelector<HTMLAnchorElement>('a[href$="/entries/new"]')?.getAttribute('href'),
    element.querySelector('h3')?.textContent,
  ])));
}

function ownEntries(page: Page, diary: Locator, patientId: string): Locator {
  return diary.getByTestId('lume-diario-entry').filter({
    has: page.locator(`a[href="/patients/${patientId}/entries/new"]`),
  });
}

async function captureBaseline(page: Page): Promise<DiaryBaseline> {
  const rows = await readGlobalWindow(page);
  await page.goto('/diary');
  const cards = page.getByTestId('lume-diario').getByTestId('lume-diario-entry');
  await expect(cards).toHaveCount(rows.length);
  const lastDate = Math.max(Date.now(), ...rows.map((row) => Date.parse(row.date)).filter(Number.isFinite));
  return { signatures: await diarySignatures(cards), nextDate: lastDate + 1000 };
}

async function assertWindowPreserved(
  page: Page, diary: Locator, patientId: string, ownCount: number, baseline: DiaryBaseline,
): Promise<number> {
  const total = Math.min(50, baseline.signatures.length + ownCount);
  const cards = diary.getByTestId('lume-diario-entry');
  await expect(cards).toHaveCount(total);
  await expect(ownEntries(page, diary, patientId)).toHaveCount(ownCount);
  const otherCards = cards.filter({ hasNot: page.locator(`a[href="/patients/${patientId}/entries/new"]`) });
  expect(await diarySignatures(otherCards)).toEqual(baseline.signatures.slice(0, 50 - ownCount));
  await expect(diary.locator('[data-lume-filo="spina"]')).toHaveCount(total > 1 ? 1 : 0);
  if (total > 1) {
    await expect(diary.locator('[data-lume-filo="spina"]')).toHaveAttribute('data-lume-filo-node-count', String(total));
  }
  return total;
}

async function createSequence(page: Page, nextDate: number): Promise<string> {
  const patientId = await createPatient(page);
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 1`,
    date: new Date(nextDate).toISOString(),
    status: 'signed',
    source: 'Ambulatorio sintetico',
    author: 'Dr.ssa Demo',
  });
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 2`,
    date: new Date(nextDate + 1000).toISOString(),
    status: 'signed',
    source: 'Referto sintetico',
  });
  await createEntry(page, patientId, {
    title: `${FIXTURE_PREFIX} 3`,
    date: new Date(nextDate + 2000).toISOString(),
    status: 'draft',
    source: 'Dettatura sintetica',
    author: 'Dr.ssa Demo',
  });
  return patientId;
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
  const baseline = await captureBaseline(page);
  const patientId = await createSequence(page, baseline.nextDate);
  if (diaryCase) await setRegister(page, diaryCase.register);
  await page.goto('/diary');
  await page.waitForLoadState('domcontentloaded');
  const diary = page.getByTestId('lume-diario');
  await expect(diary).toBeVisible();
  await assertWindowPreserved(page, diary, patientId, 3, baseline);
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
    type Rgba = readonly [number, number, number, number];
    const parse = (value: string): Rgba => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
    };
    const compose = (foreground: Rgba, background: Rgba): Rgba => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    // @Codex: a transparent entry inherits the first painted ancestor; evaluating
    // its own computed background as black would measure a non-existent surface.
    const paintedBackground = (element: HTMLElement): Rgba => {
      const ancestors: HTMLElement[] = [];
      for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.push(current);
      return ancestors.reverse().reduce<Rgba>(
        (background, ancestor) => compose(parse(getComputedStyle(ancestor).backgroundColor), background),
        [255, 255, 255, 1],
      );
    };
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (value: Rgba) => {
      const [red, green, blue] = value.map(channel);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const ratio = (foreground: Rgba, background: Rgba) => {
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
      draft: ratio(parse(getComputedStyle(draftText).color), paintedBackground(draft)),
      signed: ratio(parse(getComputedStyle(signedText).color), paintedBackground(signed)),
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

async function assertReflowStack(diary: Locator): Promise<void> {
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
  test.afterEach(async ({ page }) => {
    await cleanupCreatedPatients(page);
  });

  test('Filo coerente con la sequenza reale e le voci globali preesistenti', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const baseline = await captureBaseline(page);
    const diary = page.getByTestId('lume-diario');
    if (baseline.signatures.length === 0) {
      await expect(diary).toContainText('Nessuna voce clinica nel diario locale.');
    } else {
      await expect(diary).not.toContainText('Nessuna voce clinica nel diario locale.');
    }
    const patientId = await createPatient(page);
    await assertWindowPreserved(page, diary, patientId, 0, baseline);
    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 1`,
      date: new Date(baseline.nextDate).toISOString(),
      status: 'signed',
      source: 'Ambulatorio sintetico',
      author: 'Dr.ssa Demo',
    });
    await page.reload();
    await assertWindowPreserved(page, diary, patientId, 1, baseline);

    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 2`,
      date: new Date(baseline.nextDate + 1000).toISOString(),
      status: 'signed',
      source: 'Referto sintetico',
    });
    await createEntry(page, patientId, {
      title: `${FIXTURE_PREFIX} 3`,
      date: new Date(baseline.nextDate + 2000).toISOString(),
      status: 'draft',
      source: 'Dettatura sintetica',
      author: 'Dr.ssa Demo',
    });
    await page.reload();

    const entries = diary.getByTestId('lume-diario-entry');
    const feed = page.getByRole('feed', { name: 'Diario clinico globale' });
    await expect(feed).toBeVisible();
    const total = await assertWindowPreserved(page, diary, patientId, 3, baseline);
    await expect(diary.locator('[data-lume-diary-node]')).toHaveCount(total);
    await expect(entries.first()).toContainText('Bozza');
    await expect(entries.first()).toContainText('Fonte: Dettatura sintetica');
    await expect(entries.first()).toContainText('Autore: Dr.ssa Demo');
    await assertNoSideStripe(diary, entries);

    const registerFamily = await resolvedRegisterFamily(page);
    // @Codex: dates orient chronology in the ordinary text face; provenance
    // remains Registro. Both retain their distinct, observable presentation.
    const metaFamilies = await diary.locator('[data-lume-entry-part="provenance"]').evaluateAll(
      (elements) => elements.map((element) => getComputedStyle(element).fontFamily),
    );
    expect(new Set(metaFamilies)).toEqual(new Set([registerFamily]));
    const diaryFamily = await diary.evaluate((element) => getComputedStyle(element).fontFamily);
    const dates = await diary.locator('[data-lume-entry-part="date"]').evaluateAll((elements) =>
      elements.map((element) => ({
        family: getComputedStyle(element).fontFamily,
        numeric: getComputedStyle(element).fontVariantNumeric,
      })),
    );
    expect(dates).toHaveLength(total);
    expect(new Set(dates.map((date) => date.family))).toEqual(new Set([diaryFamily]));
    expect(dates.every((date) => date.numeric === 'tabular-nums')).toBe(true);
    await assertContrastAndFocus(page, entries, 'giorno');

    const firstEntry = entries.first();
    await firstEntry.getByRole('button', { name: 'Apri quadro', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(firstEntry.getByRole('link', { name: 'Nuova voce', exact: true })).toBeFocused();

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
      await assertNoHorizontalOverflow(page, [
        { label: 'documento diario', selector: 'document' },
        { label: 'diario', selector: '[data-testid="lume-diario"]' },
      ]);
      await assertReflowStack(diary);
      const activeEntry = entries.filter({ hasText: `${FIXTURE_PREFIX} 3` });
      await assertNotClippedInViewport(activeEntry, 'voce attiva del diario');
      await assertKeyboardFocusProgresses(page, activeEntry.getByRole('button', { name: 'Apri quadro', exact: true }), 'azione Apri quadro');
      await diary.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `/tmp/lume-diario-${diaryCase.register}-${diaryCase.viewport}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
});
