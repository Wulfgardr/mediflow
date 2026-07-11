/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import test from 'node:test';
/* @Codex */
import { completeSissPortalHandoff, openSissPrescrizione, prepareSissPortalWindow } from './siss';

type PopupStub = {
    opener: unknown;
    location: { href: string };
    blurCalls: number;
    focusCalls: number;
    blur: () => void;
    focus: () => void;
};

function createPopupStub(): PopupStub {
    return {
        opener: { source: 'test' },
        location: { href: '' },
        blurCalls: 0,
        focusCalls: 0,
        blur() {
            this.blurCalls += 1;
        },
        focus() {
            this.focusCalls += 1;
        },
    };
}

function replaceGlobal(name: 'window' | 'navigator' | 'document', value: unknown): () => void {
    const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, name);
    const previous = (globalThis as Record<string, unknown>)[name];

    Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
    });

    return () => {
        if (hadOwn) {
            Object.defineProperty(globalThis, name, {
                value: previous,
                configurable: true,
                writable: true,
            });
            return;
        }

        delete (globalThis as Record<string, unknown>)[name];
    };
}

function muteConsoleWarn(): () => void {
    const original = console.warn;
    console.warn = () => undefined;
    return () => {
        console.warn = original;
    };
}

function captureConsoleError(): {
    calls: unknown[][];
    restore: () => void;
} {
    const original = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
        calls.push(args);
    };
    return {
        calls,
        restore: () => {
            console.error = original;
        },
    };
}

test('prepareSissPortalWindow detaches opener on pre-opened popup', () => {
    const popup = createPopupStub();
    let localFocusCalls = 0;
    const restoreWindow = replaceGlobal('window', {
        open: () => popup,
        focus: () => {
            localFocusCalls += 1;
        },
    });

    try {
        const prepared = prepareSissPortalWindow();
        assert.equal(prepared, popup as unknown as Window);
        assert.equal(popup.opener, null);
        assert.equal(popup.blurCalls, 1);
        assert.equal(localFocusCalls, 1);
    } finally {
        restoreWindow();
    }
});

test('completeSissPortalHandoff reuses provided popup without opening a second window', async () => {
    const popup = createPopupStub();
    let openCalls = 0;
    let copiedText: string | null = null;

    const restoreWindow = replaceGlobal('window', {
        open: () => {
            openCalls += 1;
            return popup;
        },
    });
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            writeText: async (value: string) => {
                copiedText = value;
            },
        },
    });
    const restoreDocument = replaceGlobal('document', {
        createElement: () => {
            throw new Error('fallback not expected');
        },
        body: {
            appendChild: () => undefined,
            removeChild: () => undefined,
        },
        execCommand: () => true,
    });

    try {
        const result = await completeSissPortalHandoff({
            handoffUrl: 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard',
            clipboardText: 'rssmra85t10a562s',
            popupWindow: popup as unknown as Window,
        });

        assert.equal(openCalls, 0);
        assert.equal(copiedText, 'RSSMRA85T10A562S');
        assert.equal(popup.location.href, 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard');
        assert.equal(popup.focusCalls, 1);
        assert.deepEqual(result, {
            success: true,
            opened: true,
            message: 'CF "RSSMRA85T10A562S" copiato! Incollalo nel modulo SISS (Cmd+V).',
        });
    } finally {
        restoreDocument();
        restoreNavigator();
        restoreWindow();
    }
});

test('openSissPrescrizione opens the PRREG dashboard and copies the fiscal code', async () => {
    const popup = createPopupStub();
    let copiedText: string | null = null;
    const restoreWindow = replaceGlobal('window', {
        open: () => popup,
        focus: () => undefined,
    });
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            writeText: async (value: string) => {
                copiedText = value;
            },
        },
    });
    const restoreDocument = replaceGlobal('document', {
        body: {
            appendChild: () => undefined,
            removeChild: () => undefined,
        },
    });

    try {
        const result = await openSissPrescrizione('rssmra85t10a562s');

        assert.equal(copiedText, 'RSSMRA85T10A562S');
        assert.equal(popup.location.href, 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard');
        assert.deepEqual(result, {
            success: true,
            opened: true,
            message: 'CF "RSSMRA85T10A562S" copiato! Incollalo nel Prescrittivo Regionale (PRREG) (Cmd+V).',
        });
    } finally {
        restoreDocument();
        restoreNavigator();
        restoreWindow();
    }
});

test('completeSissPortalHandoff reports blocked popup when pre-open fails', async () => {
    const restoreWindow = replaceGlobal('window', {
        open: () => null,
    });

    try {
        const result = await completeSissPortalHandoff({
            handoffUrl: 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard',
        });

        assert.deepEqual(result, {
            success: false,
            opened: false,
            message: 'Il browser ha bloccato l\'apertura del portale SISS. Consenti i popup e riprova.',
        });
    } finally {
        restoreWindow();
    }
});

test('completeSissPortalHandoff keeps the popup open when clipboard copy fails', async () => {
    const popup = createPopupStub();
    const restoreConsoleWarn = muteConsoleWarn();
    const restoreWindow = replaceGlobal('window', {
        open: () => popup,
    });
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            writeText: async () => {
                throw new Error('clipboard denied');
            },
        },
    });
    const restoreDocument = replaceGlobal('document', {
        createElement: () => {
            throw new Error('fallback denied');
        },
        body: {
            appendChild: () => undefined,
            removeChild: () => undefined,
        },
        execCommand: () => false,
    });

    try {
        const result = await completeSissPortalHandoff({
            handoffUrl: 'https://operatorisiss.servizirl.it/fse/',
            clipboardText: 'rssmra85t10a562s',
            popupWindow: popup as unknown as Window,
        });

        assert.equal(popup.location.href, 'https://operatorisiss.servizirl.it/fse/');
        assert.equal(popup.focusCalls, 1);
        assert.deepEqual(result, {
            success: false,
            opened: true,
            message: 'Portale SISS aperto, ma non sono riuscito a copiare il CF. Copia manualmente: RSSMRA85T10A562S',
        });
    } finally {
        restoreDocument();
        restoreNavigator();
        restoreWindow();
        restoreConsoleWarn();
    }
});

test('completeSissPortalHandoff skips clipboard writes when the document is not focused', async () => {
    const popup = createPopupStub();
    let writeCalls = 0;
    const capturedErrors = captureConsoleError();
    const restoreWindow = replaceGlobal('window', {
        open: () => popup,
    });
    const restoreNavigator = replaceGlobal('navigator', {
        clipboard: {
            writeText: async () => {
                writeCalls += 1;
                throw new Error('clipboard should not be called');
            },
        },
    });
    const restoreDocument = replaceGlobal('document', {
        hasFocus: () => false,
        createElement: () => {
            throw new Error('fallback should not be called');
        },
        body: {
            appendChild: () => undefined,
            removeChild: () => undefined,
        },
        execCommand: () => false,
    });

    try {
        const result = await completeSissPortalHandoff({
            handoffUrl: 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard',
            clipboardText: 'rssmra85t10a562s',
            popupWindow: popup as unknown as Window,
        });

        assert.equal(writeCalls, 0);
        assert.equal(capturedErrors.calls.length, 0);
        assert.equal(popup.location.href, 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard');
        assert.equal(popup.focusCalls, 1);
        assert.deepEqual(result, {
            success: false,
            opened: true,
            message: 'Portale SISS aperto, ma non sono riuscito a copiare il CF. Copia manualmente: RSSMRA85T10A562S',
        });
    } finally {
        restoreDocument();
        restoreNavigator();
        restoreWindow();
        capturedErrors.restore();
    }
});
