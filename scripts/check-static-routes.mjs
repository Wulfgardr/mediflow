import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = JSON.parse(readFileSync(new URL('./static-routes-baseline.json', import.meta.url), 'utf8'));

export function checkStaticRoutes(manifest) {
  if (manifest.version !== 4 || !manifest.routes || !manifest.dynamicRoutes) throw new Error('Unsupported prerender manifest');
  const expected = new Set(baseline.staticRoutes);
  const actual = new Set(Object.entries(manifest.routes)
    .filter(([, value]) => value.initialRevalidateSeconds === false)
    .map(([route]) => route)
    .filter(route => !['/_global-error', '/favicon.ico', '/plugin-local-ui'].includes(route)));
  const missing = [...expected].filter(route => !actual.has(route));
  const unexpected = [...actual].filter(route => !expected.has(route));
  if (missing.length || unexpected.length) {
    throw new Error(`Static routes differ from ${baseline.revision}:\n${missing.map(route => `Lost prerendering: ${route}`).concat(unexpected.map(route => `Unexpected prerendering: ${route}`)).join('\n')}`);
  }
  return `${expected.size} static routes match ${baseline.revision}; plugin-local-ui is the only permitted page exception`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = JSON.parse(readFileSync(path.join(process.env.MEDIFLOW_NEXT_DIST_DIR || '.next', 'prerender-manifest.json'), 'utf8'));
  console.log(checkStaticRoutes(manifest));
}
