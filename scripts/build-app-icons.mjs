// Rasterize the approved SVG sources without adding masks or changing the mark.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'public/brand/mediflow');
const out = process.argv[2] || join(root, 'out-icons');
mkdirSync(out, { recursive: true });

const giorno = readFileSync(join(source, 'punto-giorno.svg'), 'utf8');
const grafite = readFileSync(join(source, 'punto-grafite.svg'), 'utf8');
const foreground = readFileSync(join(source, 'punto-fg.svg'), 'utf8');
const adaptive = giorno.replace('<defs>', `<style>
  @media (prefers-color-scheme: dark) {
    #bg stop:first-child { stop-color: #1a1d22; }
    #bg stop:last-child { stop-color: #101216; }
    path:first-child { stroke: #9aa3b0; }
    path:last-child { stroke: #9db4ff; }
    circle { fill: #e9ecef; }
  }
</style><defs>`);
writeFileSync(join(out, 'icon.svg'), adaptive);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function raster(svg, size) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    return page.screenshot({ omitBackground: true });
  }
  for (const [name, svg] of [['giorno', giorno], ['grafite', grafite]]) {
    for (const size of [192, 512]) {
      writeFileSync(join(out, `punto-${name}-${size}.png`), await raster(svg, size));
    }
  }
  writeFileSync(join(out, 'apple-icon.png'), await raster(giorno, 180));

  // ICO stores three PNG frames; the foreground keeps the tab icon transparent.
  const frames = [];
  for (const size of [16, 32, 48]) frames.push({ size, png: await raster(foreground, size) });
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  for (const [index, { size, png }] of frames.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  writeFileSync(join(out, 'favicon.ico'), Buffer.concat([directory, ...frames.map(frame => frame.png)]));
} finally {
  await browser.close();
}
console.log(`Web icons written to ${out}`);
