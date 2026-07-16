// MediFlow icon v6 (finale): il Filo del diario, verticale puro. Tempo, e il presente in luce.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || './out6';
mkdirSync(OUT, { recursive: true });

const REG = {
  giorno:  { c0: '#fbfaf7', c1: '#eef0f2', line: '#33506b', nodeCore: '#ffffff' },
  grafite: { c0: '#191c21', c1: '#121417', line: '#8fb0cc', nodeCore: '#fbfaf7' },
};

function strokeFor(px) {
  if (px <= 16) return 200;
  if (px <= 32) return 156;
  if (px <= 64) return 116;
  if (px <= 128) return 94;
  return 76;
}

function master(reg, { stroke = 76, fg = false } = {}) {
  const r = REG[reg];
  const focalR = Math.max(128, stroke * 1.7);
  const smallR = Math.max(54, stroke * 0.72);
  const ringW = Math.max(28, stroke * 0.37);
  const bg = fg ? '' : `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${r.c0}"/>
        <stop offset="1" stop-color="${r.c1}"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}
    <line x1="512" y1="150" x2="512" y2="870" stroke="${r.line}" stroke-width="${stroke}" stroke-linecap="round"/>
    <circle cx="512" cy="150" r="${smallR}" fill="${r.line}"/>
    <circle cx="512" cy="870" r="${smallR}" fill="${r.line}"/>
    <circle cx="512" cy="510" r="${focalR}" fill="${r.nodeCore}" stroke="${r.line}" stroke-width="${ringW}"/>
  </svg>`;
}

for (const reg of ['giorno', 'grafite']) {
  writeFileSync(join(OUT, `mediflow-icon-${reg}.svg`), master(reg, {}));
  writeFileSync(join(OUT, `mediflow-icon-${reg}-fg.svg`), master(reg, { fg: true }));
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const reg of ['giorno', 'grafite']) {
  for (const px of [1024, 512, 256, 128, 64, 32, 16]) {
    const svg = master(reg, { stroke: strokeFor(px) });
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<style>*{margin:0}</style><div style="width:${px}px;height:${px}px">${svg.replace('<svg ', `<svg width="${px}" height="${px}" `)}</div>`);
    await page.screenshot({ path: join(OUT, `mediflow-${reg}-${px}.png`), clip: { x: 0, y: 0, width: px, height: px } });
  }
}
for (const reg of ['giorno', 'grafite']) {
  const svg = master(reg, {});
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(`<style>*{margin:0}body{background:${reg==='giorno'?'#d8dce0':'#0a0a0c'}}</style>
    <div style="width:432px;height:432px;margin:40px;border-radius:96px;overflow:hidden">${svg.replace('<svg ', '<svg width="432" height="432" ')}</div>`);
  await page.screenshot({ path: join(OUT, `masked-${reg}-512.png`) });
}
await browser.close();
console.log('v6 done');
