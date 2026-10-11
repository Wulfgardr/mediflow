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
    /** Nothing is sent yet: the policy would accept the text as a passphrase, so it needs a second, deliberate gesture. */
    | { action: 'confirm-long-pin' };

/** What the lock screen shows while it holds such a text back. The confirmation is valid only while this is on screen. */
export const LONG_PIN_NOTICE = 'Questo archivio si sblocca con il PIN, e ciò che hai scritto è lungo come una passphrase. Se è il tuo PIN, premi di nuovo Sblocca.';
/** How long the notice must have been on screen before a submit can confirm: the second click of a double click is not a second gesture. */
export const LONG_PIN_NOTICE_MIN_MS = 700;

export type UnlockAttempt = {
    /** What the field said while the person typed. */
    shown: UnlockParameters['credential'];
    /** What the server answered after the gesture; null when it could not be known. */
    current: UnlockParameters | null;
    secret: string;
    /** The person submitted the unchanged text again while LONG_PIN_NOTICE was on screen. */
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
    // passphrase in between. A text the policy would accept as that passphrase therefore never
    // leaves on the first gesture. A PIN like that exists only if it was chosen at first setup,
    // and then the person confirms it; by that second gesture the server has been asked again.
    if (checkPassphrase(secret).ok && !longPinConfirmed) return { action: 'confirm-long-pin' };
    return { action: 'send-pin' };
}
