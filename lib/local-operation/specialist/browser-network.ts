import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { chromium } from '@playwright/test';
import { deny } from '../contract.ts';

const switches = ['--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND'];

export async function launchConfinedBrowser() {
    const proxy = createServer((_request, response) => { response.writeHead(403).end(); });
    proxy.on('connect', (_request, socket) => socket.destroy());
    proxy.on('upgrade', (_request, socket) => socket.destroy());
    await new Promise<void>(resolve => { proxy.listen(0, '127.0.0.1', resolve); });
    const address = proxy.address(); if (!address || typeof address === 'string') deny();
    const proxySwitch = `--proxy-server=http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ headless: true, args: [proxySwitch, ...switches] }).catch(async error => {
        await closeProxy(); throw error;
    });
    async function closeProxy() {
        proxy.closeAllConnections(); await new Promise<void>(resolve => { proxy.close(() => resolve()); });
    }
    async function close() { await browser.close(); await closeProxy(); }
    try {
        const cdp = await browser.newBrowserCDPSession();
        const { arguments: actual } = await cdp.send('Browser.getBrowserCommandLine');
        if (![proxySwitch, ...switches].every(value => actual.includes(value))) deny();
        await cdp.detach();
        const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
        context.setDefaultTimeout(2500); context.setDefaultNavigationTimeout(2500);
        const probe = await context.newPage(), udp = createSocket('udp4');
        let packets = 0; udp.on('message', () => packets++);
        await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
        try {
            await probe.evaluate(async port => {
                const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] });
                try {
                    peer.createDataChannel('preflight'); await peer.setLocalDescription(await peer.createOffer());
                    await new Promise(resolve => setTimeout(resolve, 300));
                } finally { peer.close(); }
            }, udp.address().port);
            if (packets !== 0) deny();
        } finally { udp.close(); await probe.close(); }
        return { browser, context, close };
    } catch (error) { await close(); throw error; }
}
