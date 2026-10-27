import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { installWorklistTodoFixture } from './fixtures/worklist-todo';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

test('Da fare: controlli confermati, letture negative, filtri e ritorno alla riga', async ({ baseURL }, info) => {
  test.setTimeout(180_000);
  if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL
    || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw Error('Owned synthetic archive required');
  const baseline = process.env.WORKLIST_TODO_BASELINE === '1';
  const directory = process.env.WORKLIST_TODO_SCREENSHOTS ? `${process.env.WORKLIST_TODO_SCREENSHOTS}/attempt-${info.retry}` : undefined;
  const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
  const fixture = await installWorklistTodoFixture(page, baseURL);
  fixture.state.patients[2].lastName = 'Inventata C con cognome composto eccezionalmente lungo per verificare la riga';
  fixture.state.checkups = [
    { id: 'b1', patientId: 'B', title: 'Controllo pressorio confermato', date: '2026-10-20T09:00:00Z', status: 'pending' },
    { id: 'c2', patientId: 'C', title: 'Secondo controllo', date: '2026-11-02T09:00:00Z', status: 'pending' },
    { id: 'c1', patientId: 'C', title: 'Rivalutazione concordata con titolo lungo per verificare il testo senza tagli', date: '2026-10-21T09:00:00Z', status: 'pending' },
    { id: 'c3', patientId: 'C', title: 'Terzo controllo', date: '2026-11-03T09:00:00Z', status: 'pending' },
    { id: 'a-done', patientId: 'A', title: 'Già concluso', date: '2026-10-20T09:00:00Z', status: 'completed' },
    { id: 'a-cancel', patientId: 'A', title: 'Annullato', date: '2026-10-20T09:00:00Z', status: 'cancelled' },
    { id: 'a-deleted', patientId: 'A', title: 'Eliminato', date: '2026-10-20T09:00:00Z', status: 'pending', deletedAt: '2026-10-20T10:00:00Z' },
  ];
  const worklist = page.getByTestId('lume-worklist'), rows = page.getByTestId('lume-patient-row');
  const row = (id: string) => rows.filter({ has: page.locator('strong', { hasText: `Inventata ${id}` }) });
  const frames: unknown[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let release = () => {};
  try {
    await page.context().addCookies([{ name: 'ambulatory_id', value: 'w21c-synthetic-a', url: baseURL }]);
    await bootstrapUnlockedSession(page, '1234');
    await page.goto('/?area=incarico');
    await expect(rows).toHaveCount(3);
    for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', 'zoom-200']) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
      if (size === 'zoom-200') await zoom.setZoom(2);
      else await page.setViewportSize({ width: Number(size), height: 1000 });
      await page.evaluate(value => {
        localStorage.setItem('mediflow-theme', value);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(value);
        document.documentElement.style.colorScheme = value;
      }, theme === 'giorno' ? 'light' : 'dark');
      await row('A').scrollIntoViewIfNeeded();
      const frame = await worklist.evaluate(element => {
        const visible = (node: Element) => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0;
        return { cssWidth: innerWidth, containerWidth: element.clientWidth,
          columns: [...element.querySelectorAll('[data-worklist-column]')].filter(visible).map(node => node.textContent),
          rows: [...element.querySelectorAll('[data-testid=lume-patient-row]')].map(node => {
            const box = node.getBoundingClientRect(), css = getComputedStyle(node);
            return { text: node.textContent, height: box.height, gap: css.columnGap, padding: css.padding,
              radius: css.borderRadius, overflow: node.scrollWidth - node.clientWidth };
          }), commands: [...document.querySelectorAll('[data-patient-directory] > header a, [data-patient-directory] > header button')].filter(visible).map(node => {
            const r = node.getBoundingClientRect(), css = getComputedStyle(node);
            return { text: node.textContent, width: r.width, height: r.height, padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft], gap: css.gap };
          }), primaryCount: document.querySelectorAll('[data-patient-directory] [data-lume-action=primary]').length,
          palette: getComputedStyle(element).color };
      });
      frames.push({ theme, size, zoom: size === 'zoom-200' ? 2 : 1, ...frame });
      if (directory) {
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/ready-${theme}-${size}.png`, animations: 'disabled' });
      }
      if (baseline) {
        expect.soft(await row('B').getByText('Controllo pressorio confermato', { exact: true }).isVisible()).toBe(true);
      } else {
        await expect(row('A')).toContainText('Nessun controllo aperto');
        await expect(row('B')).toContainText('Controllo pressorio confermato');
        await expect(row('C')).toContainText('Altri 2 controlli');
        await expect(row('C')).toContainText('Rivalutazione concordata');
        if (frame.containerWidth < 700) expect(frame.columns).toEqual(['Paziente', 'Da fare']);
        expect(frame.primaryCount).toBe(1);
        for (const command of frame.commands) {
          expect(command.height, command.text ?? '').toBeGreaterThanOrEqual(frame.cssWidth <= 700 ? 44 : 40);
          expect(command.width).toBeGreaterThanOrEqual(40);
          expect(command.padding).toEqual(['8px', '16px', '8px', '16px']);
        }
        for (const measured of frame.rows) {
          expect(measured.height).toBeGreaterThanOrEqual(frame.cssWidth <= 700 ? 44 : 40);
          expect(measured.gap).toBe('12px'); expect(measured.radius).toBe('0px'); expect(measured.overflow).toBeLessThanOrEqual(1);
        }
        await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }, { label: 'worklist', selector: '[data-testid=lume-worklist]' }]);
      }
    }
    if (baseline) return;
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    expect(new Set((frames as { palette: string }[]).map(frame => frame.palette)).size).toBe(2);
    fixture.state.checkupStatus = 503;
    fixture.state.checkupHold = new Promise<void>(resolve => { release = resolve; });
    await page.reload(); await expect(rows).toHaveCount(3);
    await expect(row('A')).toContainText('Lettura controlli');
    await expect(worklist.getByText('Nessun controllo aperto', { exact: true })).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
    await search.fill('Inventata B'); await expect(rows).toHaveCount(1); await expect(search).toBeFocused();
    fixture.state.checkupHold = null; release();
    await expect(worklist.getByRole('alert')).toContainText('Impossibile leggere i controlli');
    await expect(search).toBeFocused(); await expect(rows).toHaveCount(1);
    await expect(row('B')).toContainText('Controlli non disponibili');
    const batchBefore = fixture.calls.filter(call => call.path === '/api/checkups').length;
    fixture.state.checkupStatus = 200;
    await worklist.getByRole('button', { name: 'Riprova controlli', exact: true }).click();
    await expect(row('B')).toContainText('Controllo pressorio confermato');
    expect(fixture.calls.filter(call => call.path === '/api/checkups').length).toBe(batchBefore + 1);
    expect(fixture.calls.filter(call => call.path === '/api/checkups').every(call => !/patientId|limit|offset/.test(call.search))).toBe(true);
    await page.getByRole('button', { name: 'Archivio', exact: true }).click(); await expect(rows).toHaveCount(0);
    await search.fill('Inventata'); await expect(rows).toHaveCount(1); await expect(row('Z')).toContainText('Nessun controllo aperto');
    await page.getByRole('button', { name: 'Attivi', exact: true }).click();
    await search.fill('Inventata C'); await expect(rows).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 1000 });
    await row('C').click();
    await expect(page).toHaveURL(/\/patients\/C\/modules$/);
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Inventata C');
    await page.goBack();
    await expect(search).toHaveValue('Inventata C');
    await expect(row('C')).toBeFocused(); await expect(row('C')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Attivi', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(row('C')).toContainText('Altri 2 controlli');
    expect(errors).toEqual([]); expect(fixture.blocked).toEqual([]);
  } finally {
    release();
    const receipt = JSON.stringify({ baseline, frames, calls: fixture.calls, blocked: fixture.blocked, errors }, null, 2);
    await info.attach('worklist-todo-receipt', { contentType: 'application/json', body: receipt });
    if (directory) await writeFile(`${directory}/receipt.json`, receipt);
    await zoom.close();
  }
});
