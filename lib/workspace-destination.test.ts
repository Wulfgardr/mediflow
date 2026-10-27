import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentWorkspaceDestination, workspaceDestinationHrefs } from './workspace-destination';

for (const prefix of ['/settings', '/analytics', '/scales', '/patients']) {
  for (const suffix of ['-x', '-x/', '-x?next=/settings', '-x#settings']) {
    test(`no current destination for false prefix ${prefix}${suffix}`, () => {
      assert.equal(currentWorkspaceDestination(prefix + suffix, null), null);
    });
  }
}
for (const route of ['/unknown', '/unknown?next=/analytics', '/unknown#/settings', '/']) {
  test(`no directory fallback is announced for ${route}`, () => {
    assert.equal(currentWorkspaceDestination(route, null), null);
  });
}
const routes: [string, string | null, string][] = [
  ...['incarico', 'turno', 'diario', 'repertori'].map(area => ['/', area, `/?area=${area}`] as [string, string, string]),
  ['/', 'governance', '/settings'], ['/diary', null, '/?area=diario'],
  ['/settings', null, '/settings'], ['/settings/ai/modelli', null, '/settings'],
  ['/analytics', null, '/analytics'], ['/analytics/report', null, '/analytics'],
  ['/scales', null, '/scales'], ['/scales/catalogo', null, '/scales'],
  ['/patients/synthetic-id/modules', null, '/?area=incarico'],
  ['/patients/synthetic-id/diary', 'governance', '/?area=incarico'],
];
for (const [route, area, expected] of routes) {
  for (const suffix of ['', '/', '?next=/settings-x', '#analytics-x', '/?q=x#scales-x']) {
    const url = route === '/' && suffix.startsWith('/') ? suffix : route + suffix;
    test(`only ${expected} is current for ${url}, area=${area}`, () => {
      const current = currentWorkspaceDestination(url, area);
      assert.equal(current, expected);
      assert.deepEqual(workspaceDestinationHrefs.filter(href => href === current), [expected]);
      const falsePrefix = route === '/' ? '/unknown' : route.replace(/^(\/[^/]+)/, '$1-x');
      assert.equal(currentWorkspaceDestination(falsePrefix + suffix, area), null);
    });
  }
}
