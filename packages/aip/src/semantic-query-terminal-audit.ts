/* @Codex */
import { types } from 'node:util';

import {
  SemanticQueryOperationV1Error,
  semanticQueryOperationDiscardPromise,
  semanticQueryOperationFail,
  type SemanticQueryOperationTerminalAuditCommitV1,
} from './semantic-query-operation-contract.ts';

/** Preserves the audit owner's real synchronous persistence decision point. */
export function commitSemanticQueryTerminalAuditV1(source: SemanticQueryOperationTerminalAuditCommitV1,
  intent: unknown, decideAtCommit: () => unknown): unknown {
  let decisions = 0, terminalAudit: unknown, decisionFailure: unknown, decisionFailed = false;
  const decide = (): unknown => {
    decisions += 1;
    if (decisions !== 1) return semanticQueryOperationFail('audit_failed');
    try { terminalAudit = decideAtCommit(); } catch (error) {
      decisionFailed = true; decisionFailure = error; throw error;
    }
    if (!terminalAudit || typeof terminalAudit !== 'object' || types.isProxy(terminalAudit)
      || types.isPromise(terminalAudit)) return semanticQueryOperationFail('audit_failed');
    return terminalAudit;
  };
  let committed: unknown;
  try { committed = source(intent, decide); } catch (error) {
    if (decisionFailed && error === decisionFailure) throw error;
    if (error instanceof SemanticQueryOperationV1Error) throw error;
    return semanticQueryOperationFail('audit_failed');
  }
  if (semanticQueryOperationDiscardPromise(committed) || decisions !== 1 || committed !== terminalAudit) {
    return semanticQueryOperationFail('audit_failed');
  }
  return committed;
}
