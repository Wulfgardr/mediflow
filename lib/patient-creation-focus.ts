export function focusPatientCreationTarget(target: HTMLElement): void {
    const document = target.ownerDocument;
    const active = document.activeElement;
    if (active?.isConnected && active !== document.body && active !== document.documentElement) return;
    const dialogs = document.querySelectorAll('dialog[open], [aria-modal="true"]');
    if (Array.from(dialogs).some(dialog => dialog.getClientRects().length > 0)) return;
    target.focus();
}
