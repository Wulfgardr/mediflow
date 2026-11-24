'use client';

import { useCallback, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Bold, Ellipsis, Heading1, Heading2, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Pilcrow, Strikethrough, Underline } from 'lucide-react';

import { decodeClinicalRichTextEntities, isClinicalRichTextHtml, sanitizeClinicalRichTextHtml } from '@/lib/clinical-rich-text';
import { cn } from '@/lib/utils';
import styles from './clinical-rich-text-editor.module.css';

/*
 * WUL-UIUX: document.execCommand e deprecato e incoerente cross-browser.
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
    { command: 'insertUnorderedList', label: 'Elenco puntato', icon: List },
    { command: 'insertOrderedList', label: 'Elenco numerato', icon: ListOrdered },
];

export type ClinicalEditorFocus = { resume: () => void };
export type ClinicalSelectionExcerpt = { before: string; selected: string; after: string };

function selectionExcerpt(editor: HTMLElement, range: Range): ClinicalSelectionExcerpt {
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(editor);
    after.setStart(range.endContainer, range.endOffset);
    const left = Array.from(before.toString());
    const right = Array.from(after.toString());
    const selected = Array.from(range.toString());
    return {
        before: (left.length > 72 ? '…' : '') + left.slice(-72).join(''),
        selected: selected.slice(0, 48).join('') + (selected.length > 48 ? '…' : ''),
        after: right.slice(0, 48).join('') + (right.length > 48 ? '…' : ''),
    };
}

interface ClinicalRichTextEditorProps {
    ref?: Ref<ClinicalEditorFocus>;
    className?: string;
    description?: string;
    label?: string;
    onChange: (value: string) => void;
    onLeaveSelection?: (excerpt: ClinicalSelectionExcerpt) => void;
    placeholder?: string;
    value: string;
}

/* #75: toolbar e canvas usano solo superfici Lume opache. */
const TOOLBAR_BUTTON_CLASS = 'mf-button-icon';

const HTML_SYNTAX = /<[a-z/!?]|&(?:#[a-z0-9]+|[a-z][a-z0-9]*);/iu;

function readEditorValue(editor: HTMLDivElement): string {
    const text = editor.textContent ?? '';
    if (!editor.firstElementChild && !HTML_SYNTAX.test(text)) return text;

    const html = sanitizeClinicalRichTextHtml(editor.innerHTML.replace(/\n/g, '<br>'));
    if (!html || isClinicalRichTextHtml(html)) return html;
    return `<p>${html}</p>`;
}

function updateEditorEmptyState(editor: HTMLDivElement) {
    editor.dataset.empty = String(!editor.textContent?.trim());
}

export function ClinicalRichTextEditor({
    ref,
    className,
    description = 'Editor su più righe. Usa la barra degli strumenti per formattare il resoconto; Tab sposta il focus al controllo successivo.',
    label = 'Resoconto clinico',
    onChange,
    onLeaveSelection,
    placeholder = '',
    value,
}: ClinicalRichTextEditorProps) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const emittedValue = useRef<string | null>(null);
    const attachEditor = useCallback((editor: HTMLDivElement | null) => {
        editorRef.current = editor;
        if (!editor) return;
        if (value !== emittedValue.current) {
            emittedValue.current = null;
            if (isClinicalRichTextHtml(value)) {
                editor.innerHTML = sanitizeClinicalRichTextHtml(value);
            } else {
                editor.textContent = decodeClinicalRichTextEntities(value);
            }
        }
        updateEditorEmptyState(editor);
    }, [value]);
    const selectionRef = useRef<{ anchor: Node; anchorOffset: number; focus: Node; focusOffset: number }>(null);
    useImperativeHandle(ref, () => ({
        resume() {
            const editor = editorRef.current;
            if (!editor) return;
            editor.focus();
            const saved = selectionRef.current;
            if (saved && editor.contains(saved.anchor) && editor.contains(saved.focus)) {
                window.getSelection()?.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
            }
        },
    }), []);
    const rememberSelection = () => {
        const selection = window.getSelection();
        const editor = editorRef.current;
        if (selection?.anchorNode && selection.focusNode
            && editor?.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
            selectionRef.current = { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
                focus: selection.focusNode, focusOffset: selection.focusOffset };
            onLeaveSelection?.(selectionExcerpt(editor, selection.getRangeAt(0)));
        }
    };
    const descriptionId = useId();
    const editorId = useId();
    const [isFocused, setIsFocused] = useState(false);
    const [expandedTools, setExpandedTools] = useState(false);
    const moreToolsRef = useRef<HTMLButtonElement>(null);

    const syncValue = () => {
        const editor = editorRef.current;
        if (!editor) return;
        updateEditorEmptyState(editor);
        const nextValue = readEditorValue(editor);
        if (nextValue === (emittedValue.current ?? value)) return;
        emittedValue.current = nextValue;
        onChange(nextValue);
    };

    const runCommand = (command: string, value?: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        if (execCommandSafe(command, value)) syncValue();
        setExpandedTools(false);
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        if (execCommandSafe('insertText', text)) syncValue();
    };

    return (
        <div
            data-lume-editor-work-in-progress="true"
            data-testid="lume-clinical-editor"
            className={cn(
                styles.root, 'min-w-0 max-w-full overflow-hidden rounded-[var(--lume-radius-card)] border bg-[color:var(--lume-surface-focal)] transition-[border-color] duration-[var(--lume-dur-riga)] ease-[var(--lume-ease)]',
                isFocused
                    ? 'border-[color:var(--lume-accent)]'
                    : 'border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)]',
                className,
            )}
        >
            {/* #75 */}
            <div
                role="group"
                aria-controls={editorId}
                aria-label="Strumenti del resoconto clinico"
                data-lume-editor-surface="toolbar"
                data-expanded={expandedTools}
                onKeyDown={event => {
                    if (event.key === 'Escape' && expandedTools) {
                        setExpandedTools(false);
                        moreToolsRef.current?.focus();
                    }
                }}
                className={cn(styles.toolbar, "flex min-w-0 max-w-full flex-wrap items-center gap-2 border-b border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-2")}
            >
                {BLOCK_ACTIONS.map(({ command, icon: Icon, label, value: actionValue }) => (
                    <button
                        key={`${command}-${label}`}
                        data-formatting-secondary={command === 'formatBlock' || undefined}
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

                {INLINE_ACTIONS.map(({ command, icon: Icon, label }) => (
                    <button
                        key={command}
                        data-formatting-secondary={command !== 'bold' && command !== 'italic' || undefined}
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

                <div data-formatting-secondary className="ml-auto flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => runCommand('outdent')}
                        className={TOOLBAR_BUTTON_CLASS}
                        aria-label="Riduci rientro"
                        title="Riduci rientro"
                    >
                        <IndentDecrease className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => runCommand('indent')}
                        className={TOOLBAR_BUTTON_CLASS}
                        aria-label="Aumenta rientro"
                        title="Aumenta rientro"
                    >
                        <IndentIncrease className="h-4 w-4" />
                    </button>
                </div>
                <button ref={moreToolsRef} type="button" className={cn(TOOLBAR_BUTTON_CLASS, styles.more)}
                    aria-label={expandedTools ? 'Riduci strumenti di formattazione' : 'Altri strumenti di formattazione'}
                    aria-expanded={expandedTools} onClick={() => setExpandedTools(value => !value)}>
                    <Ellipsis className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            {/* #75 */}
            <div
                data-lume-editor-surface="canvas"
                className={cn(
                    'min-w-0 max-w-full bg-[color:var(--lume-surface-focal)] px-5 py-4',
                    isFocused && 'shadow-[var(--lume-focus-ring)]',
                )}
            >
                <div
                    ref={attachEditor}
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
                    className="clinical-rich-editor min-h-[320px] min-w-0 max-w-full whitespace-pre-wrap break-words bg-[color:var(--lume-surface-focal)] outline-none"
                    onBlur={() => {
                        rememberSelection();
                        setIsFocused(false);
                    }}
                    onFocus={() => {
                        execCommandSafe('defaultParagraphSeparator', 'p', true);
                        setIsFocused(true);
                    }}
                    onInput={syncValue}
                    onPaste={handlePaste}
                    onDrop={event => {
                        if (event.dataTransfer.types.includes('text/html')) event.preventDefault();
                    }}
                />
                <p id={descriptionId} className="mt-3 text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                    {description}
                </p>
            </div>
        </div>
    );
}
