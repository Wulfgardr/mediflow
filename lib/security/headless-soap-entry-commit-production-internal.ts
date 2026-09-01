/* @Codex */
import 'server-only';

import { headlessSoapCommandBindingProductionOwner } from './headless-soap-command-binding-production-internal';
import { createHeadlessSoapEntryCommitApplicationService } from './headless-soap-entry-commit-application-service';
import { createHeadlessSoapEntryCommitOwner } from './headless-soap-entry-commit-owner';
import { serverSessionProjectionOwnerProductionOwner } from './server-session-projection-owner-production-internal';

const headlessSoapEntryCommitOwner = createHeadlessSoapEntryCommitOwner();

/** Shared H7 application service; approval, selection and SQLite authorities remain private. */
export const headlessSoapEntryCommitProductionService = createHeadlessSoapEntryCommitApplicationService({
    approvalController: headlessSoapCommandBindingProductionOwner.approvalController,
    selectionController: serverSessionProjectionOwnerProductionOwner.selectionCommitBindingController,
    commitOwner: headlessSoapEntryCommitOwner,
});
