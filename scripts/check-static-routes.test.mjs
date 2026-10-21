import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkStaticRoutes } from './check-static-routes.mjs';

const baseline = JSON.parse(readFileSync(new URL('./static-routes-baseline.json', import.meta.url), 'utf8'));
const fixture = () => ({ version: 4, dynamicRoutes: {}, routes: Object.fromEntries(
  [...baseline.staticRoutes, '/_global-error', '/favicon.ico'].map(route => [route, { initialRevalidateSeconds: false }]),
) });

test('main static routes remain prerendered, with only the new plugin page permitted', () => {
  assert.match(checkStaticRoutes(fixture()), /static routes match/);
  const withPlugin = fixture();
  withPlugin.routes['/plugin-local-ui'] = { initialRevalidateSeconds: false };
  assert.match(checkStaticRoutes(withPlugin), /static routes match/);
});

test('root-level dynamic rendering loses ordinary pages and fails the build guard', () => {
  const dynamicRoot = fixture();
  for (const route of baseline.staticRoutes) {
    if (!['/apple-icon.png', '/icon.svg', '/manifest.webmanifest'].includes(route)) delete dynamicRoot.routes[route];
  }
  assert.throws(() => checkStaticRoutes(dynamicRoot), /Lost prerendering: \/\n/);
  assert.throws(() => checkStaticRoutes(dynamicRoot), /Lost prerendering: \/settings/);
});

test('revalidated pages and unreviewed static routes do not silently match the baseline', () => {
  const revalidated = fixture();
  revalidated.routes['/settings'].initialRevalidateSeconds = 60;
  assert.throws(() => checkStaticRoutes(revalidated), /Lost prerendering: \/settings/);
  const extra = fixture();
  extra.routes['/unexpected'] = { initialRevalidateSeconds: false };
  assert.throws(() => checkStaticRoutes(extra), /Unexpected prerendering: \/unexpected/);
  assert.throws(() => checkStaticRoutes({ routes: {} }), /Unsupported prerender manifest/);
});
