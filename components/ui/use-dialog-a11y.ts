'use client';

/* @Codex WUL-UIUX: hook condiviso per l'accessibilita dei dialoghi, estratto dal
   pattern gia collaudato di patient-action-modal.tsx: Escape per chiudere,
   autofocus sul primo campo utile, focus trap sul Tab, ripristino del focus alla
   chiusura. onClose viene tenuto in un ref perche i parent lo passano spesso come
   arrow inline e si ri-renderizzano a ogni scrittura Dexie (useLiveQuery): senza
   il ref l'effetto si ri-eseguirebbe e ruberebbe il focus mentre si digita. */

import { useEffect, useRef, type RefObject } from 'react';

export function useDialogA11y(
    isOpen: boolean,
    dialogRef: RefObject<HTMLElement | null>,
    onClose: () => void,
): void {
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const previouslyFocused = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        const dialog = dialogRef.current;
        const focusables = () =>
            dialog
                ? Array.from(
                      dialog.querySelectorAll<HTMLElement>(
                          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
                      ),
                  ).filter((el) => el.offsetParent !== null)
                : [];
        const initial = focusables().find((el) => el.tagName !== 'BUTTON') ?? focusables()[0] ?? dialog;
        initial?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key === 'Tab') {
                const list = focusables();
                if (list.length === 0) return;
                const first = list[0];
                const last = list[list.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            /* @Codex WUL-UIUX: ripristina il focus solo se l'elemento e ancora nel
               DOM; se e stato smontato (es. la riga che ha aperto il dialogo),
               evita che il focus cada sul body. */
            const previous = previouslyFocused.current;
            if (previous && document.body.contains(previous)) {
                previous.focus?.();
            }
        };
    }, [isOpen, dialogRef]);
}
