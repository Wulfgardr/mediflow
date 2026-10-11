/* ADR 0143: what the browser prepares before it asks the server to move the account from its
   PIN to a passphrase. The server cannot open either wrapping, so the check that each one
   contains the master key is made here, before anything is sent. */
import type { PassphraseAdoptionPayload } from './passphrase-adoption-validation';
import {
    createRecoveryWrapping,
    createUnlockWrapping,
    deriveUnlockMaterial,
    openRecoveryWrapping,
    openUnlockWrapping,
} from './unlock-credential';

/** The file kept with the backups. It holds the second wrapping of the master key and never the recovery key. */
export type RecoveryKit = {
    format: 'mediflow-recovery-kit';
    version: 1;
    createdAt: string;
    wrappedMasterKey: string;
    salt: string;
};

export type PreparedPassphraseAdoption = {
    /** Shown to the person once; it goes on paper, apart from the kit. */
    recoveryKey: string;
    kit: RecoveryKit;
    /** What goes to the server with the current PIN. */
    request(currentPin: string): PassphraseAdoptionPayload;
};

type Wrappings = {
    createUnlockWrapping: typeof createUnlockWrapping;
    createRecoveryWrapping: typeof createRecoveryWrapping;
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function sameKey(left: CryptoKey, right: CryptoKey): Promise<boolean> {
    const [a, b] = await Promise.all([left, right].map(async (key) => new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key))));
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * Makes the passphrase wrapping and the recovery wrapping of the unlocked master key, then opens
 * both again the way an unlock and a recovery would. A wrapping that does not give the same
 * master key back is never returned: the account stays on its PIN.
 */
export async function preparePassphraseAdoption(
    masterKey: CryptoKey,
    passphrase: string,
    wrappings: Wrappings = { createUnlockWrapping, createRecoveryWrapping },
): Promise<PreparedPassphraseAdoption> {
    const unlock = await wrappings.createUnlockWrapping(masterKey, passphrase);
    const recovery = await wrappings.createRecoveryWrapping(masterKey);

    const material = await deriveUnlockMaterial(passphrase, fromBase64(unlock.salt));
    const recovered = await openRecoveryWrapping(recovery.wrappedMasterKey, recovery.salt, recovery.recoveryKey);
    const verified = material.verifier === unlock.verifier
        && recovered.verifier === recovery.verifier
        && await sameKey(await openUnlockWrapping(unlock.encryptedMasterKey, material.kek), masterKey)
        && await sameKey(recovered.masterKey, masterKey);
    if (!verified) throw new Error('The new wrappings do not open the master key');

    return {
        recoveryKey: recovery.recoveryKey,
        kit: {
            format: 'mediflow-recovery-kit',
            version: 1,
            createdAt: new Date().toISOString(),
            wrappedMasterKey: recovery.wrappedMasterKey,
            salt: recovery.salt,
        },
        request: (currentPin) => ({
            currentPin,
            encryptedMasterKey: unlock.encryptedMasterKey,
            salt: unlock.salt,
            verifier: unlock.verifier,
            recovery: { wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt, verifier: recovery.verifier },
        }),
    };
}
