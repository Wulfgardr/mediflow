'use client';

import { useRef, useState } from 'react';
import { FolderDown } from 'lucide-react';

import type { DossierInputFile } from '@/lib/document-dossier-session';
import { fseFolderMessage, readFseFolder, type FseFolderReading } from '@/lib/territorial/lombardia/fse-folder';
import { formatCountLabel } from '@/lib/format-count';

export type FseFolderReady = Extract<FseFolderReading, { kind: 'ready' }>;

function inputFile(file: File): DossierInputFile {
    return {
        name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        read: async () => new Uint8Array(await file.arrayBuffer()),
    };
}

export function fseUnreadNotice(unread: number): string {
    return `${formatCountLabel(unread, 'file non ha', 'file non hanno')} il nome dato dal Fascicolo: non letti.`;
}

export default function FseFolderButton({ patient, disabled, onReady }: {
    patient: { taxCode: string | null | undefined } | null;
    disabled?: boolean;
    onReady: (reading: FseFolderReady) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [refusal, setRefusal] = useState<string | null>(null);
    const choose = (list: FileList | null) => {
        if (!list?.length) return;
        const reading = readFseFolder([...list].map(inputFile), patient);
        if (reading.kind !== 'ready') { setRefusal(fseFolderMessage(reading)); return; }
        setRefusal(null);
        onReady(reading);
    };
    return <>
        <button type="button" className="mf-button-secondary" disabled={disabled} onClick={() => input.current?.click()}>
            <FolderDown size={16} aria-hidden="true" />Documenti dal Fascicolo
        </button>
        <input ref={input} type="file" hidden multiple data-testid="fse-folder" {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={(event) => { const list = event.currentTarget.files; choose(list); event.currentTarget.value = ''; }} />
        {refusal ? <p role="alert" data-testid="fse-folder-refusal">{refusal}</p> : null}
    </>;
}
