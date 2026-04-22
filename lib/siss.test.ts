/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import test from 'node:test';
/* @Codex */
import { completeSissPortalHandoff, prepareSissPortalWindow } from './siss';

type PopupStub = {
    opener: unknown;
    location: { href: string };
    focusCalls: number;
    focus: () => void;
};

function createPopupStub(): PopupStub {
    return {
        opener: { source: 'test' },
        location: { href: '' },
        focusCalls: 0,
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

function muteConsoleError(): () => void {
    const original = console.error;
    console.error = () => undefined;
    return () => {
        console.error = original;
    };
}

test('prepareSissPortalWindow detaches opener on pre-opened popup', () => {
    const popup = createPopupStub();
    const restoreWindow = replaceGlobal('window', {
        open: () => popup,
    });

    try {
        const prepared = prepareSissPortalWindow();
        assert.equal(prepared, popup as unknown as Window);
        assert.equal(popup.opener, null);
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
            handoffUrl: 'https://operatorisiss.servizirl.it/prescrizione/',
            clipboardText: 'rssmra85t10a562s',
            popupWindow: popup as unknown as Window,
        });

        assert.equal(openCalls, 0);
        assert.equal(copiedText, 'RSSMRA85T10A562S');
        assert.equal(popup.location.href, 'https://operatorisiss.servizirl.it/prescrizione/');
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

test('completeSissPortalHandoff reports blocked popup when pre-open fails', async () => {
    const restoreWindow = replaceGlobal('window', {
        open: () => null,
    });

    try {
        const result = await completeSissPortalHandoff({
            handoffUrl: 'https://operatorisiss.servizirl.it/prescrizione/',
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
    const restoreConsole = muteConsoleError();
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
        restoreConsole();
    }
});
