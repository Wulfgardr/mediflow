import type { NetworkInterfaceInfo } from 'node:os';
import {
    choosePairingAddress as choosePairingAddressImpl,
    readPairingAddress as readPairingAddressImpl,
} from './network-pairing-address.mjs';

export function choosePairingAddress(
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
    bindHost: string,
    defaultRouteAddress: string | undefined,
): string | null {
    return choosePairingAddressImpl(interfaces, bindHost, defaultRouteAddress);
}

export async function readPairingAddress(bindHost: string): Promise<string | null> {
    return readPairingAddressImpl(bindHost);
}
