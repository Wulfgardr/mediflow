'use client';

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import type { RefObject } from 'react';
import { PatientSheetMenu } from './patient-sheet-menu';
import { Button } from '@/components/ui/button';

type PatientSheetActionsMenuProps = {
    editHref: string;
    canShareFhirFile: boolean;
    onExportFhir: () => void;
    onShareFhir: () => void;
    onReportPdf: () => void;
    leadingActions?: readonly { label: string; onSelect: () => void }[];
    triggerRef?: RefObject<HTMLButtonElement | null>;
    onOpen?: () => void;
};

export function PatientSheetActionsMenu({ editHref, canShareFhirFile, onExportFhir, onShareFhir,
    onReportPdf, leadingActions = [], triggerRef: suppliedRef, onOpen }: PatientSheetActionsMenuProps) {
    return <PatientSheetMenu label="Azioni scheda" triggerRef={suppliedRef} onOpen={onOpen}
        trigger={props => <Button {...props} variant="secondary"><MoreHorizontal size={16} aria-hidden="true" />Azioni</Button>}>
        {leadingActions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1}
                className="mf-popover-row" onClick={action.onSelect}>{action.label}</button>)}
        <Link href={editHref} role="menuitem" tabIndex={-1} className="mf-popover-row">Modifica</Link>
        <button type="button" role="menuitem" tabIndex={-1} className="mf-popover-row" onClick={onExportFhir}>Esporta FHIR</button>
        {canShareFhirFile ? <button type="button" role="menuitem" tabIndex={-1} className="mf-popover-row" onClick={onShareFhir}>Condividi FHIR</button> : null}
        <button type="button" role="menuitem" tabIndex={-1} className="mf-popover-row" onClick={onReportPdf}>Report PDF</button>
        <Link href={editHref} role="menuitem" tabIndex={-1} className="mf-popover-row">Archivia</Link>
    </PatientSheetMenu>;
}
