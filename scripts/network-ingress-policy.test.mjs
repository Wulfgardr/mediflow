import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { networkIngressRoutes, allowsNetworkIngress } from '../lib/security/network-ingress-policy.mjs';

test('remote ingress admits closed native and network routes, never the Web surface', () => {
    for (const [method, route] of [['GET', '/api/v1/network/node'], ['POST', '/api/auth/native/login'],
        ['GET', '/api/auth/check'], ['PUT', '/api/auth/profile'], ['POST', '/api/auth/change-pin']]) {
        assert.equal(allowsNetworkIngress(method, route), true, route);
    }
    for (const route of ['/api/auth/login', '/api/patients', '/api/settings/network.mode', '/',
        '/api/auth/setup', '/api/v1/network/patients/../../patients', '//api/v1/network/node',
        '/api/v1/network/patients/%2e%2e', '/api/v1/network/patients/a%2fb',
        '/api/v1/network/node/extra', '/api/v1/network/patients/%zz']) {
        assert.equal(allowsNetworkIngress('POST', route), false, route);
        assert.equal(allowsNetworkIngress('GET', route), false, route);
    }
    assert.equal(allowsNetworkIngress('DELETE', '/api/v1/network/node'), false);
});

test('the allowlist covers every declared network/native route and method', () => {
    for (const directory of ['app/api/v1/network', 'app/api/auth/native']) {
        for (const relative of fs.readdirSync(directory, { recursive: true })) {
            if (!relative.endsWith('route.ts')) continue;
            const file = `${directory}/${relative}`;
            const route = `/${file.slice(4, -'/route.ts'.length)}`;
            const declaration = networkIngressRoutes.find(([path]) => path === route);
            assert.ok(declaration, route);
            const methods = [...fs.readFileSync(file, 'utf8').matchAll(/export (?:async )?function (GET|POST|PUT|DELETE|PATCH)\b/gu)].map(match => match[1]);
            assert.deepEqual(declaration[1].split(','), methods, route);
        }
    }
});
