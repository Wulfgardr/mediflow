import type { NetworkInterfaceInfo } from 'node:os';

const VIRTUAL_INTERFACE = /^(?:bridge|vmnet|vnic|vboxnet|utun|tun|tap|ipsec|ppp|gif|stf|awdl|llw|anpi|feth|docker|veth|zt|vEthernet)/iu;

export function choosePairingAddress(
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
    bindHost: string,
    defaultRouteAddress: string | undefined,
): string | null {
    const anyHost = bindHost === '0.0.0.0' || bindHost === '::';
    const rank = ({ name, address }: { name: string; address: string }) =>
        (VIRTUAL_INTERFACE.test(name) ? 2 : 0) + (address === defaultRouteAddress ? 0 : 1);
    const candidates = Object.entries(interfaces)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([name, entries]) => (entries ?? [])
            .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
            .map(entry => ({ name, address: entry.address })))
        .filter(({ address }) => anyHost || address === bindHost);
    return candidates.sort((a, b) => rank(a) - rank(b))[0]?.address ?? null;
}
