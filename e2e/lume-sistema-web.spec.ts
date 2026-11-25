import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
] as const;

const HEADER_PAGES = ['/?area=incarico', '/?area=turno', '/?area=diario', '/?area=repertori', '/da-decidere'];

type Geometry = {
  crumbVisible: boolean;
  title: { x: number; y: number } | null;
  header: Array<{ covered: boolean; label: string; y: number; height: number; radius: string; font: string }>;
  primaries: string[];
};

async function createPatient(page: Page): Promise<string> {
  const marker = Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 6);
  return page.evaluate(async (fixtureMarker) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Sistema${fixtureMarker}`,
        lastName: `Sintetico${fixtureMarker}`,
        taxCode: `SIS${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1961-05-04T00:00:00.000Z',
        notes: 'Paziente sintetico per la geometria del sistema Web. Nessun dato reale.',
      }),
    });
    if (!response.ok) throw new Error(`Fixture sistema Web: HTTP ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  }, marker);
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const title = [...document.querySelectorAll('main h1')].find(visible);
    const crumb = document.querySelector('[class*=workspaceBar]');
    const crumbBox = crumb?.getBoundingClientRect();
    const crumbProbe = crumbBox && crumbBox.width > 0 ? document.elementFromPoint(crumbBox.x + Math.min(24, crumbBox.width / 2), crumbBox.y + crumbBox.height / 2) : null;
    const crumbVisible = !crumb || (!!crumbProbe && crumb.contains(crumbProbe));
    const titleBox = title?.getBoundingClientRect();
    const commands = '.mf-button-primary, .mf-button-secondary, .mf-button-text, .mf-button-destructive, .mf-button-icon';
    const header = [...document.querySelectorAll(`[data-command-bar='testata'] :is(${commands}), [data-testid='lume-scheda-header'] :is(${commands})`)]
      .filter(visible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const probe = document.elementFromPoint(box.x + box.width / 2, box.y + 3);
        return {
          covered: !probe || !element.contains(probe),
          label: (element.getAttribute('aria-label') || (element as HTMLElement).innerText || '').trim(),
          y: Math.round(box.y),
          height: Math.round(box.height),
          radius: style.borderTopLeftRadius,
          font: `${style.fontSize}/${style.fontWeight}`,
        };
      });
    const primaries = [...document.querySelectorAll('main .mf-button-primary')]
      .filter(visible)
      .map((element) => (element as HTMLElement).innerText.trim());
    return { crumbVisible, title: titleBox ? { x: Math.round(titleBox.x), y: Math.round(titleBox.y) } : null, header, primaries };
  });
}

async function settle(page: Page, route: string): Promise<Geometry> {
  await page.goto(route);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  return geometry(page);
}

for (const viewport of VIEWPORTS) {
  test(`testata e comandi come la vista paziente, ${viewport.name}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await createPatient(page);

    const canon = await settle(page, `/patients/${patientId}/modules`);
    expect(canon.title, 'titolo della vista paziente').not.toBeNull();
    expect(canon.header.length, 'comandi della testata paziente').toBeGreaterThan(0);
    const commandTop = canon.header[0].y;
    const commandHeight = canon.header[0].height;

    const problems: string[] = [];
    for (const route of HEADER_PAGES) {
      const view = await settle(page, route);
      if (!view.title) { problems.push(`${route}: nessun titolo`); continue; }
      if (Math.abs(view.title.x - canon.title!.x) > 1) problems.push(`${route}: titolo a x=${view.title.x}, la vista paziente a ${canon.title!.x}`);
      if (Math.abs(view.title.y - canon.title!.y) > 1) problems.push(`${route}: titolo a y=${view.title.y}, la vista paziente a ${canon.title!.y}`);
      if (!view.crumbVisible) problems.push(`${route}: il percorso in alto è coperto`);
      if (view.header.length === 0) problems.push(`${route}: nessun comando nella testata`);
      for (const command of view.header) {
        const where = `${route} «${command.label}»`;
        if (Math.abs(command.y - commandTop) > 1) problems.push(`${where}: comando a y=${command.y}, la vista paziente a ${commandTop}`);
        if (command.height !== commandHeight) problems.push(`${where}: alto ${command.height}, la vista paziente ${commandHeight}`);
        if (command.covered) problems.push(`${where}: coperto da un altro elemento nel bordo alto`);
        if (command.radius !== '10px') problems.push(`${where}: raggio ${command.radius}`);
        if (command.font !== '14px/600') problems.push(`${where}: testo ${command.font}`);
      }
      if (view.primaries.length > 1) problems.push(`${route}: ${view.primaries.length} principali (${view.primaries.join(', ')})`);
    }
    expect(problems).toEqual([]);
  });
}

const COVERAGE_WIDTHS = [390, 768, 1024, 1280, 1440] as const;

async function coveredControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]';
    const controls = [...document.querySelectorAll(`main :is(${selector}), [class*=workspaceBar] :is(${selector})`)];
    const clipped = (element: Element, x: number, y: number) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (getComputedStyle(node).overflow === 'visible') continue;
        const box = node.getBoundingClientRect();
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) return true;
      }
      return false;
    };
    const scrolledUnder = (element: Element, hit: Element) => {
      let sticky: Element | null = hit;
      while (sticky && getComputedStyle(sticky).position !== 'sticky') sticky = sticky.parentElement;
      if (!sticky) return false;
      let scroller = sticky.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY === 'visible') scroller = scroller.parentElement;
      return !!scroller && scroller.contains(element) && !sticky.contains(element);
    };
    return controls.flatMap((element) => {
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return [];
      const box = element.getClientRects()[0] ?? element.getBoundingClientRect();
      if (box.width <= 2 || box.height <= 2 || box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth) return [];
      const label = (element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.getAttribute('placeholder') || element.tagName).trim().slice(0, 40);
      return [[box.x + box.width / 2, box.y + box.height / 2], [box.x + box.width / 2, box.y + Math.min(3, box.height / 2)]]
        .filter(([x, y]) => !clipped(element, x, y))
        .flatMap(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          if (hit && (element.contains(hit) || (element as HTMLInputElement).labels?.[0]?.contains(hit))) return [];
          if (hit && scrolledUnder(element, hit)) return [];
          const by = hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}` : 'nulla';
          return [`«${label}» coperto da ${by} a ${Math.round(x)},${Math.round(y)}`];
        })
        .slice(0, 1);
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`nessun comando o percorso coperto nelle viste di lavoro, tema ${theme}`, async ({ page }) => {
    test.setTimeout(300_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const problems: string[] = [];
    for (const width of COVERAGE_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of HEADER_PAGES) {
        await settle(page, route);
        await page.evaluate((selected) => {
          localStorage.setItem('mediflow-theme', selected);
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(selected);
        }, theme);
        for (const problem of await coveredControls(page)) problems.push(`${width} ${route}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });
}

const SETTINGS_PAGES = [
  '/settings', '/settings/profilo', '/settings/accesso', '/settings/aspetto', '/settings/ambulatories',
  '/settings/agenti', '/settings/backup', '/settings/conservazione', '/settings/compliance', '/settings/repertori',
  '/settings/ai', '/settings/ai/funzioni', '/settings/ai/modelli', '/settings/ai/fabric', '/settings/ai/governance',
  '/settings/ai/chatgpt', '/settings/diagnostica', '/settings/zona-pericolo', '/settings/sviluppo',
];

async function settingsGeometry(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const fields = [...document.querySelectorAll('[data-runtime-settings] :is(input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=hidden], [type=color]), select)')]
      .filter(visible)
      .filter((element) => !element.closest('.mf-composite-field'))
      .map((element) => ({ name: element.getAttribute('aria-label') || element.id || element.getAttribute('name') || element.tagName, height: Math.round(element.getBoundingClientRect().height) }));
    const search = document.querySelector('[data-testid=settings-search-trigger]');
    const order = [...document.querySelectorAll('[data-runtime-settings] .mf-button-primary')].filter(visible).flatMap((primary) => {
      const after = [];
      for (let next = primary.nextElementSibling; next; next = next.nextElementSibling) {
        if (visible(next) && next.matches('.mf-button-secondary, .mf-button-text')) after.push((next as HTMLElement).innerText.trim());
      }
      return after.length ? [`${(primary as HTMLElement).innerText.trim()} prima di ${after.join(', ')}`] : [];
    });
    return { fields, search: search && visible(search) ? Math.round(search.getBoundingClientRect().height) : null, order };
  });
}

for (const viewport of VIEWPORTS) {
  test(`impostazioni sul canone della vista paziente, ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await createPatient(page);
    const canon = await settle(page, `/patients/${patientId}/modules`);
    const problems: string[] = [];
    for (const route of SETTINGS_PAGES) {
      const view = await settle(page, route);
      const settings = await settingsGeometry(page);
      if (!view.title || Math.abs(view.title.y - canon.title!.y) > 1 || Math.abs(view.title.x - canon.title!.x) > 1) {
        problems.push(`${route}: titolo a ${JSON.stringify(view.title)}, la vista paziente a ${JSON.stringify(canon.title)}`);
      }
      if (!view.crumbVisible) problems.push(`${route}: il percorso in alto è coperto`);
      if (view.primaries.length > 1) problems.push(`${route}: ${view.primaries.length} principali (${view.primaries.join(', ')})`);
      for (const field of settings.fields) if (field.height !== 40) problems.push(`${route}: campo «${field.name}» alto ${field.height}`);
      if (settings.search !== null && settings.search !== 40) problems.push(`${route}: ricerca dell'indice alta ${settings.search}`);
      for (const wrong of settings.order) problems.push(`${route}: ${wrong}`);
    }
    expect(problems).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of COVERAGE_WIDTHS) {
    test(`nessun comando o percorso coperto nelle Impostazioni, ${width} px, tema ${theme}`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height: 1000 });
      await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
      const problems: string[] = [];
      for (const route of SETTINGS_PAGES) {
        await settle(page, route);
        await page.evaluate((selected) => {
          localStorage.setItem('mediflow-theme', selected);
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(selected);
        }, theme);
        for (const problem of await coveredControls(page)) problems.push(`${route}: ${problem}`);
        const search = await page.evaluate(() => {
          const trigger = document.querySelector('[data-testid=settings-search-trigger]');
          if (!trigger?.checkVisibility()) return null;
          const box = trigger.getBoundingClientRect();
          return [box.y + 3, box.y + box.height / 2].every((y) => trigger.contains(document.elementFromPoint(box.x + box.width / 2, y)));
        });
        if (search === false) problems.push(`${route}: «Cerca impostazione» coperto nell'indice`);
      }
      expect(problems).toEqual([]);
    });
  }
}

function secondaryPages(patientId: string) {
  return [
    { route: '/patients/new', back: '/?area=incarico' },
    { route: '/patients/import', back: '/?area=incarico' },
    { route: '/patients/import/dossier', back: '/?area=incarico' },
    { route: `/patients/${patientId}/edit`, back: `/patients/${patientId}/modules` },
    { route: '/scales', back: null },
    { route: `/patients/${patientId}/scales`, back: `/patients/${patientId}/modules` },
    { route: `/patients/${patientId}/scales/mmse`, back: `/patients/${patientId}/scales` },
    { route: '/analytics', back: null },
  ];
}

async function returnPaths(page: Page) {
  return page.evaluate(() => ({
    crumb: [...document.querySelectorAll('[class*=workspaceBar] nav a[href]')].map((link) => link.getAttribute('href')),
    inPage: [...document.querySelectorAll('main a[href]')]
      .filter((element) => element.checkVisibility())
      .map((element) => (element.getAttribute('aria-label') || (element as HTMLElement).innerText).trim())
      .filter((label) => /^Torna (a|al|ai|alla|alle|all’)\b/u.test(label)),
  }));
}

for (const viewport of VIEWPORTS) {
  test(`pagine secondarie: ritorno nel percorso, testata come la vista paziente, ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await createPatient(page);
    const canon = await settle(page, `/patients/${patientId}/modules`);
    const commandTop = canon.header[0].y;
    const commandHeight = canon.header[0].height;
    const problems: string[] = [];
    for (const { route, back } of secondaryPages(patientId)) {
      const view = await settle(page, route);
      const paths = await returnPaths(page);
      if (!view.title || Math.abs(view.title.y - canon.title!.y) > 1 || Math.abs(view.title.x - canon.title!.x) > 1) {
        problems.push(`${route}: titolo a ${JSON.stringify(view.title)}, la vista paziente a ${JSON.stringify(canon.title)}`);
      }
      if (!view.crumbVisible) problems.push(`${route}: il percorso in alto è coperto`);
      if (back && !paths.crumb.includes(back)) problems.push(`${route}: il percorso non riporta a ${back} (${paths.crumb.join(', ')})`);
      for (const label of paths.inPage) problems.push(`${route}: ritorno nella pagina «${label}»`);
      for (const command of view.header) {
        const where = `${route} «${command.label}»`;
        if (Math.abs(command.y - commandTop) > 1) problems.push(`${where}: comando a y=${command.y}, la vista paziente a ${commandTop}`);
        if (command.height !== commandHeight) problems.push(`${where}: alto ${command.height}, la vista paziente ${commandHeight}`);
        if (command.covered) problems.push(`${where}: coperto da un altro elemento nel bordo alto`);
        if (command.radius !== '10px') problems.push(`${where}: raggio ${command.radius}`);
        if (command.font !== '14px/600') problems.push(`${where}: testo ${command.font}`);
      }
      if (view.primaries.length > 1) problems.push(`${route}: ${view.primaries.length} principali (${view.primaries.join(', ')})`);
    }
    expect(problems).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`nessun comando o percorso coperto nelle pagine secondarie, tema ${theme}`, async ({ page }) => {
    test.setTimeout(400_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await createPatient(page);
    const problems: string[] = [];
    for (const width of COVERAGE_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      for (const { route } of secondaryPages(patientId)) {
        await settle(page, route);
        await page.evaluate((selected) => {
          localStorage.setItem('mediflow-theme', selected);
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(selected);
        }, theme);
        for (const problem of await coveredControls(page)) problems.push(`${width} ${route}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });
}

test('il ritorno nel percorso si raggiunge e si usa da tastiera', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patientId = await createPatient(page);
  await settle(page, `/patients/${patientId}/scales/mmse`);
  const crumb = page.getByRole('navigation', { name: 'Cartelle aperte' }).getByRole('link', { name: 'Scale cliniche', exact: true });
  await expect(crumb).toBeVisible();
  await page.locator('body').focus();
  for (let press = 0; press < 40 && !await crumb.evaluate((element) => element === document.activeElement); press++) {
    await page.keyboard.press('Tab');
  }
  await expect(crumb).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/scales$`, 'u'));
  await expect(page.locator('main h1').first()).toHaveText('Scale cliniche');
});
