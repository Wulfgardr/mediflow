'use client';

/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { Bold, Heading1, Heading2, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Pilcrow, Strikethrough, Underline } from 'lucide-react';

import { clinicalRichTextToPlainText } from '@/lib/clinical-rich-text';
import { cn } from '@/lib/utils';

/*
 * @Codex WUL-UIUX: document.execCommand e deprecato e incoerente cross-browser.
 * Finche non si migra a un editor controllato (Lexical/TipTap), almeno si fa
 * feature-detection, si controlla il valore di ritorno e si protegge da eccezioni.
 */
function execCommandSafe(command: string, value?: string, silent = false): boolean {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
        return false;
    }
    try {
        const ok = document.execCommand(command, false, value);
        if (!ok && !silent) {
            console.warn(`[ClinicalRichTextEditor] execCommand("${command}") non supportato o non applicabile`);
        }
        return ok;
    } catch (error) {
        console.warn(`[ClinicalRichTextEditor] execCommand("${command}") ha sollevato un errore`, error);
        return false;
    }
}

type ToolbarAction = {
    command: string;
    label: string;
    value?: string;
};

const INLINE_ACTIONS: Array<ToolbarAction & { icon: typeof Bold }> = [
    { command: 'bold', label: 'Grassetto', icon: Bold },
    { command: 'italic', label: 'Corsivo', icon: Italic },
    { command: 'underline', label: 'Sottolinea', icon: Underline },
    { command: 'strikeThrough', label: 'Barrato', icon: Strikethrough },
];

const BLOCK_ACTIONS: Array<ToolbarAction & { icon: typeof Heading1 }> = [
    { command: 'formatBlock', label: 'Titolo', value: '<h2>', icon: Heading1 },
    { command: 'formatBlock', label: 'Sezione', value: '<h3>', icon: Heading2 },
    { command: 'formatBlock', label: 'Paragrafo', value: '<p>', icon: Pilcrow },
    { command: 'insertUnorderedList', label: 'Bullet', icon: List },
    { command: 'insertOrderedList', label: 'Numero', icon: ListOrdered },
];

interface ClinicalRichTextEditorProps {
    className?: string;
    onChange: (value: string) => void;
    placeholder?: string;
    value: string;
}

function updateEditorEmptyState(node: HTMLDivElement | null) {
    if (!node) return;
    const plainText = clinicalRichTextToPlainText(node.innerHTML);
    node.dataset.empty = plainText.trim() ? 'false' : 'true';
}

export function ClinicalRichTextEditor({
    className,
    onChange,
    placeholder = '',
    value,
}: ClinicalRichTextEditorProps) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [isFocused, setIsFocused] = useState(false);

    /* @Codex */
    useEffect(() => {
        execCommandSafe('defaultParagraphSeparator', 'p', true);
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        if (editor.innerHTML !== value) {
            editor.innerHTML = value;
        }

        updateEditorEmptyState(editor);
    }, [value]);

    const syncValue = () => {
        const editor = editorRef.current;
        if (!editor) return;
        updateEditorEmptyState(editor);
        onChange(editor.innerHTML);
    };

    const runCommand = (command: string, value?: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        execCommandSafe(command, value);
        syncValue();
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        execCommandSafe('insertText', text);
        syncValue();
    };

    return (
        <div className={cn('space-y-4', className)}>
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[color:rgba(112,106,100,0.12)] bg-white/78 p-2 dark:bg-white/4">
                {BLOCK_ACTIONS.map(({ command, icon: Icon, label, value: actionValue }) => (
                    <button
                        key={`${command}-${label}`}
                        type="button"
                        onClick={() => runCommand(command, actionValue)}
                        className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-transparent px-3 text-sm font-medium text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(112,106,100,0.16)] hover:bg-[color:rgba(255,252,247,0.9)]"
                        aria-label={label}
                        title={label}
                    >
                        <Icon className="h-4 w-4 text-[color:var(--mf-muted)]" />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}

                <div className="mx-1 hidden h-6 w-px bg-[color:rgba(112,106,100,0.16)] sm:block" />

                {INLINE_ACTIONS.map(({ command, icon: Icon, label }) => (
                    <button
                        key={command}
                        type="button"
                        onClick={() => runCommand(command)}
                        className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-transparent px-3 text-sm font-medium text-[color:var(--mf-ink)] transition-colors hover:border-[color:rgba(112,106,100,0.16)] hover:bg-[color:rgba(255,252,247,0.9)]"
                        aria-label={label}
                        title={label}
                    >
                        <Icon className="h-4 w-4 text-[color:var(--mf-muted)]" />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => runCommand('outdent')}
                        className="inline-flex h-10 items-center justify-center rounded-[14px] px-3 text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(255,252,247,0.9)]"
                        aria-label="Riduci rientro"
                        title="Riduci rientro"
                    >
                        <IndentDecrease className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => runCommand('indent')}
                        className="inline-flex h-10 items-center justify-center rounded-[14px] px-3 text-[color:var(--mf-muted)] transition-colors hover:bg-[color:rgba(255,252,247,0.9)]"
                        aria-label="Aumenta rientro"
                        title="Aumenta rientro"
                    >
                        <IndentIncrease className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className={cn(
                'rounded-[22px] border bg-[color:rgba(255,252,247,0.9)] px-5 py-4 shadow-[0_16px_30px_rgba(35,27,22,0.06)] transition-colors',
                isFocused
                    ? 'border-[color:rgba(182,106,60,0.3)] shadow-[0_18px_34px_rgba(182,106,60,0.12)]'
                    : 'border-[color:rgba(112,106,100,0.12)]',
            )}>
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    data-empty="true"
                    data-placeholder={placeholder}
                    className="clinical-rich-editor min-h-[320px] outline-none"
                    onBlur={() => {
                        setIsFocused(false);
                        syncValue();
                    }}
                    onFocus={() => setIsFocused(true)}
                    onInput={syncValue}
                    onKeyDown={(event) => {
                        if (event.key === 'Tab') {
                            event.preventDefault();
                            runCommand(event.shiftKey ? 'outdent' : 'indent');
                        }
                    }}
                    onPaste={handlePaste}
                />
            </div>
        </div>
    );
}
