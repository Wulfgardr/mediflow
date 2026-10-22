import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFixtureService, exactOrigin } from '../src/fixture-service.mjs';

const origin = 'https://observed.example';
test('loopback only; exact CORS, closed routes, isolated sessions, revocation, expiry, restart and safe observations', async () => {
  const observations = [];
  let allowed = [];
  let clock = Date.now();
  const sentinel = `SYNTHETIC_L_${randomUUID()}`;
  const service = await createFixtureService({ sentinel, now: () => clock,
    allowedOrigins: () => allowed, observe: event => observations.push(event) });
  const view = randomUUID();
  const headers = { Origin: origin, 'X-Demo-View': view };
  const request = (path, init = {}) => fetch(service.endpoint + path, { ...init, headers: { ...headers, ...init.headers } });
  try {
    assert.match(service.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const candidate of [undefined, 'null', 'https://other.example', origin, 'https://observed.example.evil']) {
      const response = await fetch(service.endpoint + '/health', { headers: candidate ? { Origin: candidate } : {} });
      assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal((await response.text()).includes(sentinel), false);
    }
    allowed = [origin];
    const health = await request('/health'); assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), origin);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal((await health.json()).serviceId, service.serviceId);
    const preflight = await request('/fixture', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-demo-view' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-headers').includes('*'), false);
    assert.equal((await request('/fixture', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-unapproved' } })).status, 403);
    assert.equal((await request('/fixture')).status, 401);
    assert.equal((await request('/medical.db')).status, 404);
    assert.equal((await request('/fixture?patientId=arbitrary')).status, 404);
    assert.equal((await request('/admit', { method: 'POST', body: 'patientId' })).status, 400);
    const admission = await (await request('/admit', { method: 'POST' })).json();
    const auth = { Authorization: `Bearer ${admission.token}` };
    const data = await request('/fixture', { headers: auth });
    assert.equal((await data.json()).sentinel, sentinel);
    assert.equal((await request('/fixture', { headers: { ...auth, 'X-Demo-View': randomUUID() } })).status, 401);
    assert.equal((await request('/fixture', { headers: { ...auth, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await request('/revoke', { method: 'POST', headers: auth })).status, 200);
    assert.equal((await request('/fixture', { headers: auth })).status, 401);
    const next = await (await request('/admit', { method: 'POST' })).json();
    clock += 60_001;
    assert.equal((await request('/fixture', { headers: { Authorization: `Bearer ${next.token}` } })).status, 401);
    allowed = [];
    assert.equal((await request('/health')).status, 403);
    assert.equal(JSON.stringify(observations).includes(sentinel), false);
    assert.equal(JSON.stringify(observations).includes(admission.token), false);
    assert.deepEqual(Object.keys(observations[0]), ['sequence', 'method', 'route', 'origin', 'status']);
  } finally { await service.close(); }
  await assert.rejects(request('/health'));
  const restart = await createFixtureService({ allowedOrigins: () => [origin] });
  try {
    assert.notEqual(restart.serviceId, service.serviceId);
    assert.equal((await fetch(restart.endpoint + '/fixture', { headers })).status, 401);
  } finally { await restart.close(); }
  for (const bad of ['null', '*', 'https://a.example/', 'https://user:pass@a.example', 'file://a', 'https://a.example/path']) assert.equal(exactOrigin(bad), null);
});
