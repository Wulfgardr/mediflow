/* ADR 0143: what the browser does with what was typed on the lock screen. Decided in one
   place, from what the field showed, what the server says now and the text itself, so that
   a passphrase is never sent where only a PIN may travel. */
import type { UnlockParameters } from './client-auth-api';
import { checkPassphrase, UNLOCK_KDF_VERSION } from './unlock-credential';

export type UnlockPlan =
    /** Derive in the browser and send only the verifier. */
    | { action: 'derive'; salt: string }
    /** The account still unlocks with its PIN, which the server compares: it travels as typed. */
    | { action: 'send-pin' }
    /** Nothing is sent; the person is told why. */
    | { action: 'refuse'; message: string }
    /** Nothing is sent yet: the text is long enough to be a passphrase and needs a second, deliberate gesture. */
    | { action: 'confirm-long-pin'; message: string };

export type UnlockAttempt = {
    /** What the field said while the person typed. */
    shown: UnlockParameters['credential'];
    /** What the server answered after the gesture; null when it could not be known. */
    current: UnlockParameters | null;
    secret: string;
    /** The person has already been told the text looks like a passphrase and submitted it again, unchanged. */
    longPinConfirmed: boolean;
};

export function planUnlock({ shown, current, secret, longPinConfirmed }: UnlockAttempt): UnlockPlan {
    if (!current) {
        return { action: 'refuse', message: 'Non riesco a verificare come si sblocca l’archivio. Riprova.' };
    }
    if (current.credential !== shown) {
        return {
            action: 'refuse',
            message: current.credential === 'passphrase'
                ? 'Questo archivio ora si sblocca con la passphrase. Inseriscila.'
                : 'Questo archivio si sblocca con il PIN. Inseriscilo.',
        };
    }
    if (current.credential === 'passphrase') {
        if (current.kdfVersion !== UNLOCK_KDF_VERSION) {
            return { action: 'refuse', message: 'Questa versione di MediFlow non sa aprire l’archivio. Aggiorna MediFlow e riprova.' };
        }
        return { action: 'derive', salt: current.salt };
    }
    // The server's answer may already be old when the request leaves: the account can move to a
    // passphrase in between. A text that could be that passphrase therefore never leaves on the
    // first gesture. A PIN that long exists only if it was chosen at first setup, and then the
    // person confirms it; by that second gesture the server has been asked again.
    if (checkPassphrase(secret).ok && !longPinConfirmed) {
        return {
            action: 'confirm-long-pin',
            message: 'Questo archivio si sblocca con il PIN, e ciò che hai scritto è lungo come una passphrase. Se è il tuo PIN, premi di nuovo Sblocca.',
        };
    }
    return { action: 'send-pin' };
}
