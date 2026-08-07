'use client';

/* @Codex */

import Link from 'next/link';
import { Download, FileText, MoreHorizontal, Pencil, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';

type PatientSheetActionsMenuProps = {
    editHref: string;
    canShareFhirFile: boolean;
    onExportFhir: () => void;
    onShareFhir: () => void;
    onReportPdf: () => void;
};

export function PatientSheetActionsMenu({
    editHref,
    canShareFhirFile,
    onExportFhir,
    onShareFhir,
    onReportPdf,
}: PatientSheetActionsMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const closeOutside = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('mousedown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen]);

    const runAndClose = (action: () => void) => {
        setIsOpen(false);
        action();
    };

    return (
        <div ref={rootRef} className={workspaceStyles.headerActionsMenu}>
            <button
                ref={triggerRef}
                type="button"
                className={workspaceStyles.headerActionButton}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-controls="patient-sheet-actions"
                onClick={() => setIsOpen((current) => !current)}
            >
                <MoreHorizontal size={14} aria-hidden="true" />
                Azioni
            </button>
            {isOpen ? (
                <div
                    id="patient-sheet-actions"
                    className={`mf-popover ${workspaceStyles.headerActionsPopover}`}
                    role="group"
                    aria-label="Azioni scheda"
                >
                    <Link href={editHref} className="mf-popover-row" onClick={() => setIsOpen(false)}>
                        <Pencil size={14} aria-hidden="true" /> Modifica
                    </Link>
                    <button type="button" className="mf-popover-row w-full text-left" onClick={() => runAndClose(onExportFhir)}>
                        <Download size={14} aria-hidden="true" /> Esporta FHIR
                    </button>
                    {canShareFhirFile ? (
                        <button type="button" className="mf-popover-row w-full text-left" onClick={() => runAndClose(onShareFhir)}>
                            <Share2 size={14} aria-hidden="true" /> Condividi FHIR
                        </button>
                    ) : null}
                    <button type="button" className="mf-popover-row w-full text-left" onClick={() => runAndClose(onReportPdf)}>
                        <FileText size={14} aria-hidden="true" /> Report PDF
                    </button>
                </div>
            ) : null}
        </div>
    );
}
