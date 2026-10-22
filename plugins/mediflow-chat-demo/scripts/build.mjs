import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('../../docs/design/lume/tokens/lume.tokens.json', root), 'utf8'));
function declarations(value, prefix = '--lume') {
  return Object.entries(value).flatMap(([key, item]) => '$value' in item
    ? [`${prefix}-${key}:${item.$value};`] : declarations(item, `${prefix}-${key}`)).join('');
}
const themes = ['giorno', 'grafite'].map(theme => `[data-theme="${theme}"]{${declarations(tokens.register[theme])}}`).join('\n');
const font = await readFile(new URL('../../app/fonts/Newsreader-Native-Regular.ttf', root));
const result = await build({ entryPoints: [new URL('src/app.mjs', root).pathname], bundle: true,
  write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
const script = result.outputFiles[0].text.replace(/<\/script/giu, '<\\/script');
const source = await readFile(new URL('src/app.html', root), 'utf8');
const css = await readFile(new URL('src/app.css', root), 'utf8');
const html = source.replace('<!-- STYLE -->', () => `<style>@font-face{font-family:Newsreader;src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype');font-weight:400;font-display:swap}${themes}\n${css}</style>`)
  .replace('<!-- SCRIPT -->', () => `<script>${script}</script>`);
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/app.html', root), html);
await writeFile(new URL('dist/Newsreader-OFL.txt', root), await readFile(new URL('../../app/fonts/Newsreader-OFL.txt', root)));

const cardScript = await build({ entryPoints: [new URL('src/card-app.mjs', root).pathname], bundle: true,
  write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
const cardSource = await readFile(new URL('src/card.html', root), 'utf8');
const cardHtml = cardSource.replace('<!-- STYLE -->', () => `<style>@font-face{font-family:Newsreader;src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype');font-weight:400;font-display:swap}${themes}\n${css}</style>`)
  .replace('<!-- SCRIPT -->', () => `<script>${cardScript.outputFiles[0].text.replace(/<\/script/giu, '<\\/script')}</script>`);
await writeFile(new URL('dist/card.html', root), cardHtml);
