import type { Ref } from 'react';

import PrivacyBlur from '@/components/privacy-blur';
import type { DossierEvidence } from '@/lib/domain/documents/dossier-import';

type DossierPassage = { before: string; passage: string; after: string };

export function splitDossierPassage(unitTexts: ReadonlyMap<number, string>, evidence: DossierEvidence): DossierPassage | null {
    const text = unitTexts.get(evidence.unit);
    const { start, end } = evidence;
    if (text === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
        return null;
    }
    return { before: text.slice(0, start), passage: text.slice(start, end), after: text.slice(end) };
}

export function DossierEvidenceText({ text, selection, passageRef }: {
    text: string; selection: DossierPassage | null; passageRef?: Ref<HTMLElement>;
}) {
    return <PrivacyBlur>{selection
        ? <>{selection.before}<mark ref={passageRef} tabIndex={-1}>{selection.passage}</mark>{selection.after}</>
        : text}</PrivacyBlur>;
}
