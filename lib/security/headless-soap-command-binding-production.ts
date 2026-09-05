/* @Codex */
import 'server-only';

import * as internal from './headless-soap-command-binding-production-internal';

const ownerKey = ['headlessSoapCommandBinding', 'Production', 'Owner'].join('') as keyof typeof internal;
const owner = internal[ownerKey];

/** Memory-only H6 approval-binding service; write authority remains downstream in H7. */
export const headlessSoapCommandBindingService = owner.service;
