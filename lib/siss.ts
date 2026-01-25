/**
 * SISS Integration Utilities
 * Sistema Informativo Socio Sanitario - Regione Lombardia
 * 
 * Since no public APIs are available, this module provides utility functions
 * for quick-linking to SISS portals with patient data ready to paste.
 */

// --- SISS Portal URLs ---
export const SISS_URLS = {
    // Main menu
    MENU: 'https://operatorisiss.servizirl.it/menusiss/',

    // Prescrizione Dematerializzata
    PRESCRIZIONE: 'https://operatorisiss.servizirl.it/prescrizione/',
    PRESCRIZIONE_COMPILA: 'https://operatorisiss.servizirl.it/prescrizione/#compila-ricetta-page-1',

    // Fascicolo Sanitario Elettronico (for future use)
    FSE: 'https://operatorisiss.servizirl.it/fse/',

    // Anagrafe (for future use)
    ANAGRAFE: 'https://operatorisiss.servizirl.it/anagrafe/',
};

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
    message: string;
}

/**
 * Opens the SISS Prescrizione portal and copies the patient's CF to clipboard.
 * @param codiceFiscale - The patient's Codice Fiscale
 * @returns Result object with success status and user-friendly message
 */
export async function openSissPrescrizione(codiceFiscale: string): Promise<OpenSissResult> {
    if (!codiceFiscale) {
        return {
            success: false,
            message: "Codice Fiscale mancante per questo paziente."
        };
    }

    // Normalize CF (uppercase, trim)
    const normalizedCF = codiceFiscale.trim().toUpperCase();

    // Copy to clipboard
    const copied = await copyToClipboard(normalizedCF);

    if (!copied) {
        return {
            success: false,
            message: "Impossibile copiare il CF negli appunti. Copia manualmente: " + normalizedCF
        };
    }

    // Open SISS in new tab
    window.open(SISS_URLS.PRESCRIZIONE, '_blank', 'noopener,noreferrer');

    return {
        success: true,
        message: `CF "${normalizedCF}" copiato! Incollalo nel modulo SISS (Cmd+V).`
    };
}

/**
 * Opens the SISS FSE (Fascicolo Sanitario Elettronico) portal.
 * @param codiceFiscale - The patient's Codice Fiscale
 */
export async function openSissFse(codiceFiscale: string): Promise<OpenSissResult> {
    if (!codiceFiscale) {
        return {
            success: false,
            message: "Codice Fiscale mancante per questo paziente."
        };
    }

    const normalizedCF = codiceFiscale.trim().toUpperCase();
    const copied = await copyToClipboard(normalizedCF);

    if (!copied) {
        return {
            success: false,
            message: "Impossibile copiare il CF. Copia manualmente: " + normalizedCF
        };
    }

    window.open(SISS_URLS.FSE, '_blank', 'noopener,noreferrer');

    return {
        success: true,
        message: `CF "${normalizedCF}" copiato! Cercalo nel FSE.`
    };
}
