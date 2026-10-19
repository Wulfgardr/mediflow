import 'server-only';

/** Holds opaque, process-local confirmations; the caller owns admission and validity. */
export function createSingleUseConfirmationOwner<T extends object>() {
    let issued = new WeakMap<object, T>();
    return Object.freeze({
        issue(binding: T): object {
            const proof: object = Object.freeze(Object.create(null));
            issued.set(proof, binding);
            return proof;
        },
        consume(candidate: unknown): T | null {
            if (!candidate || typeof candidate !== 'object') return null;
            const binding = issued.get(candidate);
            issued.delete(candidate);
            return binding ?? null;
        },
        clear(): void { issued = new WeakMap(); },
    });
}
