import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const target = join(dirname(fileURLToPath(import.meta.url)), 'scheda-stabile-e-cambiato.html');
const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'verifica-scheda-')), {
  channel: 'chrome', chromiumSandbox: true, headless: true, viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const external = [];
page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
await page.goto(`file://${target}`);

const SIZES = [[1440, 900], [1280, 800], [1180, 760], [1000, 760], [768, 1024], [390, 844]];
const results = [];
const failures = [];
const expect = (label, ok, detail = '') => { results.push({ label, ok, detail }); if (!ok) failures.push(`${label} ${detail}`); };

const inView = (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  let clip = { top: 0, bottom: window.innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && getComputedStyle(p).display !== 'contents') { const b = p.getBoundingClientRect(); clip = { top: Math.max(clip.top, b.top), bottom: Math.min(clip.bottom, b.bottom) }; }
  }
  return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), visible: r.top >= clip.top - 1 && r.top < clip.bottom && r.width > 0 && r.height > 0, whole: r.bottom <= clip.bottom + 1 && r.top >= clip.top - 1 };
}, selector);
const overflowX = () => page.evaluate(() => {
  const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const inner = [...document.querySelectorAll('.piano *')].filter((el) => el.scrollWidth - el.clientWidth > 1 && !el.matches('.segmenti') && getComputedStyle(el).overflowX !== 'visible').map((el) => el.className);
  return { doc, inner };
});
const filled = () => page.evaluate(() => [...document.querySelectorAll('.piano .cmd.principale')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()));
const click = (selector) => page.locator(selector).first().click();
const shot = (name) => (outDir ? page.screenshot({ path: join(outDir, `${name}.png`) }) : null);

for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  const zones = w >= 1280 ? 3 : w >= 1000 ? 2 : 1;
  for (const caso of ['ritorno', 'molti-contatti', 'senza-variazioni', 'senza-visita']) {
    await click(`[data-caso="${caso}"]`);
    const tag = `${w} ${caso}`;
    const klass = await page.locator('#classe').innerText();
    expect(`${tag}: classe dichiarata`, klass.includes(zones === 3 ? 'tre zone' : zones === 2 ? 'due zone' : 'una colonna'), klass);
    const ox = await overflowX();
    expect(`${tag}: nessuno sconfinamento orizzontale`, ox.doc <= 0 && ox.inner.length === 0, JSON.stringify(ox));

    const stab = await inView('.stabile'); const centro = await inView('.diario'); const quadro = await inView('.ingresso-quadro');
    if (zones === 3) expect(`${tag}: stabile a sinistra, contesto a destra`, stab.left < centro.left && quadro.left > centro.left && stab.width <= 270, JSON.stringify({ stab, centro, quadro }));
    if (zones === 2) expect(`${tag}: laterale unica a destra, stabile sopra il contesto`, stab.left > centro.left && quadro.left > centro.left && stab.top < quadro.top, JSON.stringify({ stab, centro, quadro }));
    if (zones === 1) {
      const order = await page.evaluate(() => ['.ingresso-quadro', '.fascia, .senza-fascia', '.stabile', '.diario', '.parametri', '.controlli', '.documenti'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY)));
      expect(`${tag}: ordine in una colonna`, order.every((v, i) => i === 0 || v > order[i - 1]), order.join(' < '));
      const cols = await page.evaluate(() => { const [a, b] = document.querySelectorAll('.stabile > .sezione'); return a.getBoundingClientRect().top === b.getBoundingClientRect().top; });
      expect(`${tag}: Problemi e Terapie ${w >= 700 ? 'affiancate' : 'impilate'}`, cols === (w >= 700));
      const shown = await page.locator('.diario .voce:visible').count();
      expect(`${tag}: ultime 5 voci e «Tutto il diario»`, shown === 5 && await page.locator('.tutto-il-diario button').isVisible(), `voci ${shown}`);
    }
    for (const [name, sel] of [['identità', '.testata .nome'], ['allergie', '.testata .dati span:last-child'], ['Quadro paziente', '.ingresso-quadro .cmd']]) {
      const v = await inView(sel);
      expect(`${tag}: ${name} nel primo sguardo`, v?.visible, JSON.stringify(v));
    }
    const problems = await inView('.stabile .sezione:nth-child(1) h3');
    expect(`${tag}: Problemi ${w >= 700 ? 'nel primo sguardo' : 'entro uno scorrimento di pagina'}`, w >= 700 ? problems.visible : problems.top < 2 * h, JSON.stringify(problems));
    const changes = await page.locator('.modifiche .riga').allInnerTexts();
    const bandHasTherapy = caso === 'ritorno' || caso === 'molti-contatti';
    expect(`${tag}: «Ultime modifiche di terapia» ${bandHasTherapy ? 'assente, le porta la fascia' : 'con data'}`, bandHasTherapy ? changes.length === 0 : changes.length === 4 && changes[0].includes('12/11'), changes.join(' | ').replace(/\n/g, ' '));
    if (caso === 'ritorno' || caso === 'molti-contatti') {
      const band = await inView('.fascia h3');
      expect(`${tag}: fascia nel primo sguardo`, band?.visible, JSON.stringify(band));
      const title = await page.locator('.fascia h3').innerText();
      expect(`${tag}: intestazione con data e autore`, title === "Dall'ultima visita · 04/11 · Dott.ssa Prova Banco", title);
      const rows = await page.locator('.fascia .variazione > button').allInnerTexts();
      expect(`${tag}: solo variazioni di stato come righe`, rows.length === 3 && rows[0].includes('Aggiornata') && rows[1].includes('Sospesa') && rows[2].includes('Fuori intervallo'), rows.join(' | ').replace(/\n/g, ' '));
      const counted = await page.locator('.contatti').innerText();
      expect(`${tag}: contatti contati per tipo`, counted === (caso === 'ritorno' ? 'Nel diario dopo la visita: 1 telefonata, 1 nota' : 'Nel diario dopo la visita: 6 telefonate, 1 accesso, 3 note'), counted);
      if (zones === 3) {
        const potassium = await page.evaluate(() => { const el = document.querySelectorAll('.fascia [data-riga]')[2]; const zona = el.closest('.centro').getBoundingClientRect(); const r = el.getBoundingClientRect(); return { top: Math.round(r.top), whole: r.top >= zona.top && r.bottom <= zona.bottom }; }); const firstEntry = await inView('.diario .voce strong');
        expect(`${tag}: potassio intero e prima voce del diario nel primo sguardo`, potassium.whole && firstEntry.visible, JSON.stringify({ potassium, firstEntry }));
      }
      await click('.fascia .variazione > button >> nth=1');
      const det = await page.locator('.fascia .dettaglio').innerText();
      expect(`${tag}: terapia senza prima e dopo`, det.includes('Valore precedente non conservato') && !det.includes('→') && !/Motivo|fonte/i.test(det), det.replace(/\n/g, ' / '));
      expect(`${tag}: rimando al diario dello stesso giorno`, det.includes('Diario del 12/11: Telefonata'), det.replace(/\n/g, ' / '));
      await click('.fascia .dettaglio [data-atto="fonte"]');
      const sameDay = await page.locator('.foglio').innerText();
      expect(`${tag}: la voce dello stesso giorno si apre nel Contesto`, sameDay.includes('Telefonata del 12/11') && sameDay.includes('sospeso lo spironolattone'), sameDay.replace(/\n/g, ' / '));
      await click('[data-atto="chiudi-fonte"]');
      await click('.fascia .variazione > button >> nth=2');
      const obs = await page.locator('.fascia .dettaglio').innerText();
      expect(`${tag}: parametro con valore precedente attestato`, obs.includes('4,8 mmol/L (02/10) → 5,6 mmol/L') && obs.includes('Riferimento 3,5–5,1'), obs.replace(/\n/g, ' / '));
      await click('.fascia input[type="checkbox"]');
      const all = await page.locator('.fascia .variazione > button').allInnerTexts();
      expect(`${tag}: documenti e proposte a richiesta`, all.length === 5 && all.some((r) => r.includes('Documento aggiunto')) && all.some((r) => r.includes('Proposta')) && await page.locator('[data-atto="altre"]').count() === 0, `${all.length} righe`);
      await click('.fascia input[type="checkbox"]');
      if (caso === 'molti-contatti') {
        await click('[data-contatti="righe"]');
        const asRows = await page.locator('.fascia .variazione > button').allInnerTexts();
        const hidden = await page.locator('[data-atto="altre"]').innerText();
        expect(`${tag}: termine di confronto, con i contatti come righe le variazioni di stato escono dalle prime cinque`, asRows.length === 5 && !asRows.some((r) => /Sospesa|Aggiornata|Fuori intervallo/.test(r)) && hidden === 'Altre 8 variazioni', `${asRows.map((r) => r.split('\n').pop()).join(', ')} · ${hidden}`);
        if (w === 1440) await shot('1440-molti-contatti-righe');
        await click('[data-contatti="conteggio"]');
        if (w === 1440 || w === 390) await shot(`${w}-molti-contatti`);
      }
      if (caso === 'ritorno' && (w === 1440 || w === 768 || w === 390 || w === 1180)) await shot(`${w}-ritorno`);
      if (caso === 'ritorno') {
        await click('[data-terapia="elenco"]');
        const inBand = await page.locator('.fascia .variazione > button').allInnerTexts();
        const list = await page.locator('.stabile .sezione:nth-child(2)').innerText();
        expect(`${tag}: alternativa, la variazione di terapia sta nell'elenco`, inBand.length === 1 && inBand[0].includes('Potassio') && /Furosemide 25 mg cpr\n.*\nAggiornata il 12\/11/.test(list) && /Non più attive dopo la visita\s+Spironolattone 25 mg cpr\nSospesa il 12\/11/i.test(list) && await page.locator('.modifiche').count() === 0, list.replace(/\n/g, ' / '));
        if (w === 1440) await shot('1440-terapia-nell-elenco');
        await click('[data-terapia="fascia"]');
      }
    } else {
      const line = await page.locator('.senza-fascia').innerText();
      expect(`${tag}: riga onesta al posto della fascia`, line === (caso === 'senza-visita' ? 'Nessuna visita registrata.' : "Dall'ultima visita · 14/11 · Dott.ssa Prova Banco: nessuna variazione registrata."), line);
      expect(`${tag}: nessun confronto`, await page.locator('.fascia').count() === 0);
      if (caso === 'senza-visita' && (w === 1440 || w === 768 || w === 390)) await shot(`${w}-senza-visita`);
    }
    expect(`${tag}: un solo principale a riposo`, JSON.stringify(await filled()) === '["Nuova voce"]', JSON.stringify(await filled()));

    await click('[data-atto="scrivi"][data-oggetto="voce"]');
    await page.locator('#testo').fill('Paziente in buone condizioni generali. Edemi declivi ridotti.');
    await page.locator('#testo').evaluate((el) => { el.focus(); el.setSelectionRange(21, 21); });
    await page.waitForTimeout(40);
    expect(`${tag}: a bozza aperta il principale è «Rivedi»`, JSON.stringify(await filled()) === '["Rivedi"]', JSON.stringify(await filled()));
    if (zones > 1) {
      const d = await inView('#testo'); const dia = await inView('.diario');
      expect(`${tag}: bozza accanto al diario`, d.left > dia.left && d.visible, JSON.stringify({ d, dia }));
    } else {
      const order = await page.evaluate(() => ['.bozza', '.diario'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY)));
      expect(`${tag}: bozza prima del diario`, order[0] < order[1], order.join(' < '));
    }
    const [draftTop, docsTop, quadroTop] = await page.evaluate(() => ['.bozza', '.documenti', '.ingresso-quadro'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY)));
    const docButton = await inView('.documenti [data-atto="fonte"]');
    expect(`${tag}: a bozza aperta i documenti seguono la bozza`, zones > 1 ? draftTop < docsTop && docsTop < quadroTop && docButton.visible : draftTop < docsTop, JSON.stringify({ draftTop, docsTop, quadroTop, docButton }));
    expect(`${tag}: a bozza aperta i parametri restano`, await page.locator('.parametri').count() === 1);
    await click('.documenti [data-atto="fonte"]');
    const sheet = await inView('.foglio'); const draft = await inView('#testo');
    expect(`${tag}: fonte sopra la bozza, bozza montata`, sheet.top < draft.top && await page.locator('#testo').inputValue() !== '', JSON.stringify({ sheet, draft }));
    if (w === 1440 || w === 1180 || w === 768 || w === 390) await shot(`${w}-${caso}-fonte-e-bozza`);
    await click('[data-atto="torna"]');
    const focus = await page.evaluate(() => ({ id: document.activeElement.id, sel: document.activeElement.selectionStart }));
    expect(`${tag}: «Torna alla bozza» ridà fuoco e cursore`, focus.id === 'testo' && focus.sel === 21, JSON.stringify(focus));
    await click('[data-atto="rivedi"]');
    const review = await page.locator('.revisione').innerText();
    expect(`${tag}: revisione con paziente, tipo e testo`, /Ferraldi Bianca, 79 anni/.test(review) && /Visita, oggi/.test(review) && /Edemi declivi ridotti/.test(review), review.replace(/\n/g, ' / '));
    expect(`${tag}: in revisione il principale è «Conferma e registra»`, JSON.stringify(await filled()) === '["Conferma e registra"]', JSON.stringify(await filled()));
    const confirm = await inView('[data-atto="conferma"]');
    expect(`${tag}: «Conferma e registra» in vista`, zones > 1 ? confirm.whole : confirm.visible, JSON.stringify(confirm));
    if (w === 1440 || w === 390) await shot(`${w}-${caso}-revisione`);
    await page.keyboard.press('Escape');
    expect(`${tag}: Esc torna alla bozza`, await page.evaluate(() => document.activeElement.id === 'testo' && !document.activeElement.readOnly));
    await click('[data-atto="rivedi"]');
    await click('[data-atto="conferma"]');
    const done = await page.locator('.bozza [role="status"]').innerText();
    const top = await page.locator('.diario .voce').first().innerText();
    const reread = await page.locator('.bozza .riletta').innerText();
    expect(`${tag}: il passo 3 mostra il testo riletto`, reread === 'Paziente in buone condizioni generali. Edemi declivi ridotti.', reread);
    expect(`${tag}: esito e voce in cima al diario`, /^Registrata alle \d\d:\d\d$/.test(done.trim()) && top.includes('Edemi declivi ridotti') && /Registrata alle \d\d:\d\d da Dott\.ssa Prova Banco/.test(top), `${done} | ${top.replace(/\n/g, ' / ')}`);
    if (caso === 'ritorno') {
      const title = await page.locator('.fascia h3').innerText();
      expect(`${tag}: il riferimento non si sposta dopo la registrazione`, title.includes('04/11'), title);
    }
    await click('[data-atto="chiudi-bozza"]');

    await click('[data-atto="scrivi"][data-oggetto="nota"]');
    await page.locator('#testo').fill('Vive con la figlia. Preferisce le visite al mattino. Porta apparecchio acustico.');
    await click('[data-atto="rivedi"]');
    const noteReview = await page.locator('.revisione').innerText();
    await click('[data-atto="conferma"]');
    const note = await page.locator('.note').innerText();
    expect(`${tag}: nota riletta al suo posto con l'esito`, /Note della scheda/.test(noteReview) && note.includes('Porta apparecchio acustico') && /Registrata alle \d\d:\d\d/.test(note), note.replace(/\n/g, ' / '));
    if (caso === 'ritorno' && (w === 1440 || w === 390)) await shot(`${w}-nota-registrata`);
  }
}
await page.setViewportSize({ width: 1440, height: 900 });
await click('[data-caso="ritorno"]');
for (const tema of ['light', 'dark']) {
  await click(`[data-tema="${tema}"]`);
  await click('[data-atto="scrivi"][data-oggetto="voce"]');
  const contrast = await page.evaluate(() => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (s) => { const [r, g, b] = s.match(/\d+/g).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const field = getComputedStyle(document.getElementById('testo'));
    const around = getComputedStyle(document.querySelector('.bozza')).backgroundColor;
    return { fieldFill: +ratio(field.borderTopColor, field.backgroundColor).toFixed(2), around: +ratio(field.borderTopColor, around).toFixed(2) };
  });
  expect(`${tema}: contorno del campo almeno 3:1`, contrast.fieldFill >= 3 && contrast.around >= 3, JSON.stringify(contrast));
  await shot(`1440-${tema}-bozza`);
  await click('[data-atto="chiudi-bozza"]');
}
expect('nessuna richiesta di rete', external.length === 0, external.join(' '));

if (outDir) writeFileSync(join(outDir, 'verifica-scheda.json'), JSON.stringify(results, null, 1));
await context.close();
console.log(`${results.length - failures.length} passati su ${results.length}`);
for (const f of failures) console.log('FALLITO', f);
process.exit(failures.length ? 1 : 0);
