/**
 * SISS Integration Utilities
 * Sistema Informativo Socio Sanitario - Regione Lombardia
 *
 * This module provides utility functions for controlled browser handoff to the
 * official regional web applications currently reachable from MediFlow. It does
 * not implement a certified SISS backend integration.
 */
/* @Codex */
import { SISS_URLS } from './siss-urls';

// --- Clipboard Utility ---
async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (fallbackErr) {
            console.error('Fallback copy failed:', fallbackErr);
            return false;
        }
    }
}

// --- Open SISS Prescrizione ---
export interface OpenSissResult {
    success: boolean;
    opened: boolean;
    message: string;
}

export interface SissPortalHandoffInput {
    handoffUrl: string;
    clipboardText?: string;
    successMessage?: string;
}

export async function completeSissPortalHandoff(input: SissPortalHandoffInput): Promise<OpenSissResult> {
    if (!input.handoffUrl.trim()) {
        return {
            success: false,
            opened: false,
            message: 'Portale SISS non disponibile per questa operazione.',
        };
    }

    const normalizedText = (input.clipboardText ?? '').trim().toUpperCase();
    if (!normalizedText) {
        window.open(input.handoffUrl, '_blank', 'noopener,noreferrer');
        return {
            success: true,
            opened: true,
            message: input.successMessage ?? 'Portale SISS aperto.',
        };
    }

    const copied = await copyToClipboard(normalizedText);
    window.open(input.handoffUrl, '_blank', 'noopener,noreferrer');

    if (!copied) {
        return {
            success: false,
            opened: true,
            message: `Portale SISS aperto, ma non sono riuscito a copiare il CF. Copia manualmente: ${normalizedText}`,
        };
    }

    return {
        success: true,
        opened: true,
        message: input.successMessage ?? `CF "${normalizedText}" copiato! Incollalo nel modulo SISS (Cmd+V).`,
    };
}

/**
 * Opens the official Modulo Prescrittivo Regionale web application and copies
 * the patient's CF to clipboard.
 * @param codiceFiscale - The patient's Codice Fiscale
 * @returns Result object with success status and user-friendly message
 */
/* @Codex */
export async function openSissPrescrizione(codiceFiscale: string): Promise<OpenSissResult> {
    return await completeSissPortalHandoff({
        handoffUrl: SISS_URLS.PRESCRIZIONE_WEBAPP,
        clipboardText: codiceFiscale,
    });
}

/**
 * Opens the SISS FSE (Fascicolo Sanitario Elettronico) portal.
 * @param codiceFiscale - The patient's Codice Fiscale
 */
export async function openSissFse(codiceFiscale: string): Promise<OpenSissResult> {
    return await completeSissPortalHandoff({
        handoffUrl: SISS_URLS.FSE,
        clipboardText: codiceFiscale,
        successMessage: `CF "${codiceFiscale.trim().toUpperCase()}" copiato! Cercalo nel FSE.`,
    });
}
