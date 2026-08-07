/* @Codex */

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import type { OpenLoopGroup, ResultsPendingOpenLoop } from '@/lib/patient-open-loops';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';

const ATTENTION_GROUP_CAP = 6;

type AttentionGroupProps = {
    group: OpenLoopGroup;
    onInsertResult: (loop: ResultsPendingOpenLoop) => void;
};

export function AttentionGroup({ group, onInsertResult }: AttentionGroupProps) {
    const visibleLoops = group.loops.slice(0, ATTENTION_GROUP_CAP);
    const remaining = group.loops.length - visibleLoops.length;
    const prescribedAt = group.prescribedAt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    const examCount = `${group.loops.length} ${group.loops.length === 1 ? 'esame' : 'esami'} senza risultato`;

    return (
        <section className={workspaceStyles.attentionGroup} aria-label={`Prescrizione del ${prescribedAt}, ${examCount}`}>
            <div className={workspaceStyles.attentionGroupHead}>
                <h3 className={workspaceStyles.attentionGroupTitle}>Prescrizione dell&apos;{prescribedAt} · {examCount}</h3>
                <button
                    type="button"
                    className={workspaceStyles.attentionAction}
                    onClick={() => onInsertResult(group.loops[0])}
                >
                    Inserisci risultati
                </button>
            </div>
            <div>
                {visibleLoops.map((loop) => (
                    <button
                        key={loop.sourceRef.id}
                        type="button"
                        className={`${workspaceStyles.attentionRow} ${workspaceStyles.attentionRowButton}`}
                        aria-label={`${loop.label}: inserisci risultato`}
                        onClick={() => onInsertResult(loop)}
                        data-lume-clinical-state="warning"
                    >
                        <span className={workspaceStyles.attentionMarker} aria-hidden="true" />
                        <span className={workspaceStyles.attentionTitle}>{loop.label}</span>
                        <span className={workspaceStyles.attentionStatus}>
                            <span className="lume-registro" data-testid="lume-register-value">atteso da {loop.status.elapsedDays} gg</span>
                            <ChevronRight size={14} aria-hidden="true" />
                        </span>
                    </button>
                ))}
            </div>
            {remaining > 0 ? (
                <Link href="#prestazioni" className={workspaceStyles.attentionMore}>+{remaining} altri esami</Link>
            ) : null}
        </section>
    );
}
