import assert from 'node:assert/strict';
import type { NetworkInterfaceInfo } from 'node:os';
import { test } from 'node:test';
import { choosePairingAddress } from './network-pairing-address.ts';

const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
    address, netmask: '255.255.255.0', family: 'IPv4', mac: '02:00:00:00:00:01', internal, cidr: `${address}/24`,
});
const ipv6 = (address: string): NetworkInterfaceInfo => ({
    address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '02:00:00:00:00:01', internal: false, cidr: `${address}/64`, scopeid: 0,
});

const wifiAndCable = {
    lo0: [ipv4('127.0.0.1', true)],
    bridge100: [ipv4('10.211.55.2')],
    en0: [ipv6('fe80::1'), ipv4('172.20.10.3')],
    en8: [ipv4('10.120.51.155')],
};

test('with Wi-Fi and cable both up, the QR carries the network the default route leaves from', () => {
    assert.equal(choosePairingAddress(wifiAndCable, '0.0.0.0', '172.20.10.3'), '172.20.10.3');
    assert.equal(choosePairingAddress(wifiAndCable, '0.0.0.0', '10.120.51.155'), '10.120.51.155');
});

test('a default route through a VPN tunnel or a VM bridge does not beat a real network', () => {
    const withTunnel = { ...wifiAndCable, utun4: [ipv4('10.64.0.7')] };
    assert.equal(choosePairingAddress(withTunnel, '0.0.0.0', '10.64.0.7'), '172.20.10.3');
    assert.equal(choosePairingAddress(wifiAndCable, '0.0.0.0', '10.211.55.2'), '172.20.10.3');
});

test('without a default route, real networks still come before virtual ones listed earlier', () => {
    assert.equal(choosePairingAddress(wifiAndCable, '0.0.0.0', undefined), '172.20.10.3');
    assert.equal(choosePairingAddress({ vmnet8: [ipv4('192.168.64.1')], en5: [ipv4('192.168.1.20')] }, '0.0.0.0', undefined),
        '192.168.1.20');
});

test('with only virtual networks, the one carrying the default route is used, then the first by name', () => {
    const onlyVirtual = { bridge100: [ipv4('10.211.55.2')], utun3: [ipv4('100.101.102.103')] };
    assert.equal(choosePairingAddress(onlyVirtual, '0.0.0.0', '100.101.102.103'), '100.101.102.103');
    assert.equal(choosePairingAddress(onlyVirtual, '0.0.0.0', undefined), '10.211.55.2');
});

test('no usable network means no address', () => {
    assert.equal(choosePairingAddress({}, '0.0.0.0', undefined), null);
    assert.equal(choosePairingAddress({ lo0: [ipv4('127.0.0.1', true)], en0: [ipv4('169.254.10.2'), ipv6('fe80::1')] },
        '0.0.0.0', '169.254.10.2'), null);
});

test('an explicit bind host is the only address that can be published', () => {
    assert.equal(choosePairingAddress(wifiAndCable, '10.211.55.2', '172.20.10.3'), '10.211.55.2');
    assert.equal(choosePairingAddress(wifiAndCable, '10.120.51.155', '172.20.10.3'), '10.120.51.155');
    assert.equal(choosePairingAddress(wifiAndCable, '192.168.9.9', '172.20.10.3'), null);
    assert.equal(choosePairingAddress(wifiAndCable, '::', '10.120.51.155'), '10.120.51.155');
});
