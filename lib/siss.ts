/**
 * SISS Integration Utilities
 * Sistema Informativo Socio Sanitario - Regione Lombardia
 *
 * This module provides utility functions for controlled browser handoff to the
 * official regional web applications currently reachable from MediFlow. It does
 * not implement a certified SISS backend integration.
 */
import { SISS_URLS } from './siss-urls';
import { copyToClipboard } from './clipboard';

// --- Open SISS Prescrizione ---
export interface OpenSissResult {
    success: boolean;
    opened: boolean;
    message: string;
}

export type SissPortalWindow = Window | null;

export interface SissPortalHandoffInput {
    handoffUrl: string;
    clipboardText?: string;
    successMessage?: string;
    popupWindow?: SissPortalWindow;
}

function tryOpenSissPortalWindow(): SissPortalWindow {
    const popupWindow = window.open('', '_blank');
    if (!popupWindow) {
        return null;
    }

    try {
        popupWindow.opener = null;
    } catch (error) {
        console.error('Failed to detach SISS popup opener:', error);
    }

    try {
        popupWindow.blur();
        window.focus();
    } catch {
        // Best-effort: some browsers ignore focus restoration after opening a tab.
    }

    return popupWindow;
}

function navigateSissPortalWindow(popupWindow: Window, handoffUrl: string): boolean {
    try {
        popupWindow.location.href = handoffUrl;
        popupWindow.focus();
        return true;
    } catch (error) {
        console.error('Failed to navigate SISS popup:', error);
        return false;
    }
}

const SISS_PORTAL_HOSTS: ReadonlySet<string> = new Set(Object.values(SISS_URLS).map((url) => new URL(url).hostname));

/** The popup shares the MediFlow origin until it navigates: only an https page of the regional portal may load there. */
export function isAllowedSissHandoffUrl(handoffUrl: string): boolean {
    try {
        const url = new URL(handoffUrl.trim());
        return url.protocol === 'https:' && !url.username && !url.password && SISS_PORTAL_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

export function prepareSissPortalWindow(): SissPortalWindow {
    return tryOpenSissPortalWindow();
}

export async function completeSissPortalHandoff(input: SissPortalHandoffInput): Promise<OpenSissResult> {
    if (!isAllowedSissHandoffUrl(input.handoffUrl)) {
        try { input.popupWindow?.close(); } catch { /* the blank popup may already be gone */ }
        return {
            success: false,
            opened: false,
            message: 'Portale SISS non disponibile per questa operazione.',
        };
    }

    const popupWindow = input.popupWindow ?? tryOpenSissPortalWindow();
    if (!popupWindow) {
        return {
            success: false,
            opened: false,
            message: 'Il browser ha bloccato l\'apertura del portale SISS. Consenti i popup e riprova.',
        };
    }

    const normalizedText = (input.clipboardText ?? '').trim().toUpperCase();
    if (!normalizedText) {
        const opened = navigateSissPortalWindow(popupWindow, input.handoffUrl);
        if (!opened) {
            return {
                success: false,
                opened: false,
                message: 'Non sono riuscito ad aprire il portale SISS. Chiudi eventuali tab vuote e riprova.',
            };
        }

        return {
            success: true,
            opened,
            message: input.successMessage ?? 'Portale SISS aperto.',
        };
    }

    const copied = await copyToClipboard(normalizedText);
    const opened = navigateSissPortalWindow(popupWindow, input.handoffUrl);
    if (!opened) {
        return {
            success: false,
            opened: false,
            message: 'Non sono riuscito ad aprire il portale SISS. Chiudi eventuali tab vuote e riprova.',
        };
    }

    if (!copied) {
        return {
            success: false,
            opened,
            message: `Portale SISS aperto, ma non sono riuscito a copiare il CF. Copia manualmente: ${normalizedText}`,
        };
    }

    return {
        success: true,
        opened,
        message: input.successMessage ?? `CF "${normalizedText}" copiato! Incollalo nel modulo SISS (Cmd+V).`,
    };
}

/**
 * Opens the official Prescrittivo Regionale (PRREG) web application and copies
 * the patient's CF to clipboard.
 * @param codiceFiscale - The patient's Codice Fiscale
 * @returns Result object with success status and user-friendly message
 */
export async function openSissPrescrizione(codiceFiscale: string): Promise<OpenSissResult> {
    return await completeSissPortalHandoff({
        handoffUrl: SISS_URLS.PRESCRITTIVO_REGIONALE,
        clipboardText: codiceFiscale,
        successMessage: `CF "${codiceFiscale.trim().toUpperCase()}" copiato! Incollalo nel Prescrittivo Regionale (PRREG) (Cmd+V).`,
    });
}