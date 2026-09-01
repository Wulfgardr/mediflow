/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { headlessSoapEntryFieldSetLifecycleProductionOwner } from './headless-soap-entry-field-set-lifecycle-production-internal';
import { createHeadlessSoapEntryPresentationLifecycleOwner } from './headless-soap-entry-presentation-lifecycle';

const hostRandomBytes = randomBytes;

/** Shared process owner for H5a presentation currentness. */
export const headlessSoapEntryPresentationLifecycleProductionOwner = createHeadlessSoapEntryPresentationLifecycleOwner({
    entryLifecycle: headlessSoapEntryFieldSetLifecycleProductionOwner.lifecycleController,
    entryService: headlessSoapEntryFieldSetLifecycleProductionOwner.service,
    entropy: () => Uint8Array.from(hostRandomBytes(32)),
});
