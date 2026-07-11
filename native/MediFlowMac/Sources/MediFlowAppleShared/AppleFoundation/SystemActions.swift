import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// S3 (D3, lane PRREG): no local pattern existed yet for opening an external URL
// in the system browser or writing to the system clipboard (only ShareLink was
// in use). This is the small cross-platform seam for both, kept injectable so
// PairedPatientsWorkspaceModel can be tested with a spy instead of touching the
// real pasteboard/browser. A protocol with a real, working default conformer
// (never a throwing stub) so production code gets correct behavior for free.
protocol SystemActionsPerforming: Sendable {
    func openExternalURL(_ url: URL)
    func copyToSystemClipboard(_ text: String)
}

struct SystemActions: SystemActionsPerforming {
    func openExternalURL(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    func copyToSystemClipboard(_ text: String) {
        #if os(macOS)
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

// Root e dashboard PRREG: STESSA stringa di lib/siss-urls.ts
// (SISS_URLS.PRESCRITTIVO_REGIONALE). Se cambia la', aggiornare anche qui.
enum SissPortalURLs {
    static let prescrittivoRegionale = URL(
        string: "https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard"
    )!
}
