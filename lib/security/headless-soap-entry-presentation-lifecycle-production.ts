/* @Codex */
import 'server-only';

import * as internal from './headless-soap-entry-presentation-lifecycle-production-internal';

const ownerKey = ['headlessSoapEntryPresentationLifecycle', 'Production', 'Owner'].join('') as keyof typeof internal;
const owner = internal[ownerKey];

/** Memory-only H5a presentation service. */
export const headlessSoapEntryPresentationLifecycleService = owner.service;
