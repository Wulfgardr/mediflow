/* @Codex */
import 'server-only';

type LocatorGeneration = object;

const create = Object.create;
const freeze = Object.freeze;
const nextGeneration = (): LocatorGeneration => freeze(create(null)) as LocatorGeneration;

let currentGeneration = nextGeneration();

export function captureAttachmentExtractionLocatorGeneration(): LocatorGeneration {
    return currentGeneration;
}

export function isCurrentAttachmentExtractionLocatorGeneration(value: unknown): boolean {
    return value === currentGeneration;
}

export function revokeAttachmentExtractionLocatorGeneration(): void {
    currentGeneration = nextGeneration();
}
