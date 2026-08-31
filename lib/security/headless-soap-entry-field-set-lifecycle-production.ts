/* @Codex */
import 'server-only';

import { headlessSoapEntryFieldSetLifecycleProductionOwner } from './headless-soap-entry-field-set-lifecycle-production-internal';

/** Memory-only H4 field-set service; it grants no clinical write authority. */
export const headlessSoapEntryFieldSetLifecycleService = headlessSoapEntryFieldSetLifecycleProductionOwner.service;
