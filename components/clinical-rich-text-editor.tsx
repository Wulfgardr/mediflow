'use client';

/* @Codex */
import { useEffect, useId, useRef, useState } from 'react';
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
    description?: string;
    label?: string;
    onChange: (value: string) => void;
    placeholder?: string;
    value: string;
}

/* @Codex #75: toolbar e canvas usano solo superfici Lume opache. */
const TOOLBAR_BUTTON_CLASS = 'inline-flex h-10 items-center gap-2 rounded-[var(--lume-radius-control)] border border-transparent px-3 text-sm font-medium text-[color:var(--lume-ink)] transition-[background-color,border-color,color] duration-[var(--lume-dur-riga)] ease-[var(--lume-ease)] hover:border-[color:color-mix(in_srgb,var(--lume-ink)_16%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))] focus-visible:outline-none focus-visible:shadow-[var(--lume-focus-ring)]';
const TOOLBAR_ICON_BUTTON_CLASS = 'inline-flex h-10 items-center justify-center rounded-[var(--lume-radius-control)] px-3 text-[color:var(--lume-ink-muted)] transition-[background-color,color] duration-[var(--lume-dur-riga)] ease-[var(--lume-ease)] hover:bg-[color:color-mix(in_srgb,var(--lume-ink)_5%,var(--lume-surface-field))] hover:text-[color:var(--lume-ink)] focus-visible:outline-none focus-visible:shadow-[var(--lume-focus-ring)]';

function updateEditorEmptyState(node: HTMLDivElement | null) {
    if (!node) return;
    const plainText = clinicalRichTextToPlainText(node.innerHTML);
    node.dataset.empty = plainText.trim() ? 'false' : 'true';
}

export function ClinicalRichTextEditor({
    className,
    description = 'Editor su più righe. Usa la barra degli strumenti per formattare il resoconto; Tab sposta il focus al controllo successivo.',
    label = 'Resoconto clinico',
    onChange,
    placeholder = '',
    value,
}: ClinicalRichTextEditorProps) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const descriptionId = useId();
    const editorId = useId();
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
        <div
            data-lume-editor-work-in-progress="true"
            data-testid="lume-clinical-editor"
            className={cn(
                'min-w-0 max-w-full overflow-hidden rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-focal)] transition-[border-color,box-shadow] duration-[var(--lume-dur-riga)] ease-[var(--lume-ease)]',
                isFocused
                    ? 'border-[color:var(--lume-accent)] shadow-none'
                    : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] shadow-none',
                className,
            )}
        >
            {/* @Codex #75 */}
            <div
                role="group"
                aria-controls={editorId}
                aria-label="Strumenti del resoconto clinico"
                data-lume-editor-surface="toolbar"
                className="flex min-w-0 max-w-full flex-wrap items-center gap-2 border-b border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-2"
            >
                {BLOCK_ACTIONS.map(({ command, icon: Icon, label, value: actionValue }) => (
                    <button
                        key={`${command}-${label}`}
                        type="button"
                        onClick={() => runCommand(command, actionValue)}
                        className={TOOLBAR_BUTTON_CLASS}
                        aria-label={label}
                        title={label}
                    >
                        <Icon className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}

                <div className="mx-1 hidden h-6 w-px bg-[color:color-mix(in_srgb,var(--lume-ink)_16%,transparent)] sm:block" />

                {INLINE_ACTIONS.map(({ command, icon: Icon, label }) => (
                    <button
                        key={command}
                        type="button"
                        onClick={() => runCommand(command)}
                        className={TOOLBAR_BUTTON_CLASS}
                        aria-label={label}
                        title={label}
                    >
                        <Icon className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => runCommand('outdent')}
                        className={TOOLBAR_ICON_BUTTON_CLASS}
                        aria-label="Riduci rientro"
                        title="Riduci rientro"
                    >
                        <IndentDecrease className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => runCommand('indent')}
                        className={TOOLBAR_ICON_BUTTON_CLASS}
                        aria-label="Aumenta rientro"
                        title="Aumenta rientro"
                    >
                        <IndentIncrease className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* @Codex #75 */}
            <div
                data-lume-editor-surface="canvas"
                className={cn(
                    'min-w-0 max-w-full bg-[color:var(--lume-surface-focal)] px-5 py-4',
                    isFocused ? 'shadow-[var(--lume-focus-ring)]' : 'shadow-none',
                )}
            >
                <div
                    ref={editorRef}
                    id={editorId}
                    role="textbox"
                    aria-describedby={descriptionId}
                    aria-label={label}
                    aria-multiline="true"
                    aria-required="true"
                    contentEditable
                    suppressContentEditableWarning
                    data-empty="true"
                    data-lume-editor-surface="field"
                    data-placeholder={placeholder}
                    className="clinical-rich-editor min-h-[320px] min-w-0 max-w-full break-words bg-[color:var(--lume-surface-focal)] outline-none"
                    onBlur={() => {
                        setIsFocused(false);
                        syncValue();
                    }}
                    onFocus={() => setIsFocused(true)}
                    onInput={syncValue}
                    onPaste={handlePaste}
                />
                <p id={descriptionId} className="mt-3 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                    {description}
                </p>
            </div>
        </div>
    );
}
