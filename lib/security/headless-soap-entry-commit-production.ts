/* @Codex */
import 'server-only';

import { headlessSoapEntryCommitProductionService } from './headless-soap-entry-commit-production-internal';

/** Server-only H7 facade; all approval, selection and storage authorities stay private. */
export const headlessSoapEntryCommitService = headlessSoapEntryCommitProductionService;
