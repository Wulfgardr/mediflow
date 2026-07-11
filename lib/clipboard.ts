'use client';

function isDocumentFocused(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    if (typeof document.hasFocus !== 'function') {
        return true;
    }

    return document.hasFocus();
}

function describeClipboardError(error: unknown): string {
    if (error instanceof Error) {
        return error.name ? `${error.name}: ${error.message}` : error.message;
    }

    return typeof error === 'string' ? error : 'unknown clipboard error';
}

function warnClipboardUnavailable(stage: string, error: unknown): void {
    console.warn(`SISS clipboard ${stage} unavailable: ${describeClipboardError(error)}`);
}

function copyToClipboardWithTextArea(text: string): boolean {
    if (!isDocumentFocused()) {
        return false;
    }

    let textArea: HTMLTextAreaElement | null = null;

    try {
        textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return document.execCommand('copy');
    } catch (error) {
        warnClipboardUnavailable('fallback copy', error);
        return false;
    } finally {
        if (textArea) {
            try {
                document.body.removeChild(textArea);
            } catch {
                // The fallback is best-effort; cleanup must not turn it into a thrown failure.
            }
        }
    }
}

export async function copyToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        if (!isDocumentFocused()) {
            return false;
        }

        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            warnClipboardUnavailable('write', error);
        }
    }

    return copyToClipboardWithTextArea(text);
}
