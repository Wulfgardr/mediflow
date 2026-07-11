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
    func openExternalURL(_ url: URL) async -> Bool
    func copyToSystemClipboard(_ text: String) async -> Bool
}

struct SystemActions: SystemActionsPerforming {
    func openExternalURL(_ url: URL) async -> Bool {
        #if os(macOS)
        return NSWorkspace.shared.open(url)
        #else
        return await withCheckedContinuation { continuation in
            Task { @MainActor in
                UIApplication.shared.open(url, options: [:]) { didOpen in
                    continuation.resume(returning: didOpen)
                }
            }
        }
        #endif
    }

    func copyToSystemClipboard(_ text: String) async -> Bool {
        #if os(macOS)
        return await MainActor.run {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            return pasteboard.setString(text, forType: .string)
        }
        #else
        return await MainActor.run {
            // UIKit exposes a setter but no success callback. Reaching the end
            // of the setter is the strongest observable production outcome;
            // injected test doubles still exercise the failure presentation.
            UIPasteboard.general.string = text
            return true
        }
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
