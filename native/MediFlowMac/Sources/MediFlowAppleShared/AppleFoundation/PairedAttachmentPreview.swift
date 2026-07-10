import SwiftUI
import PDFKit
import MediFlowCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// S6 (Wave 5, D12): in-memory attachment preview. The decrypted `data` field is
// a data URL; this never writes it to a temporary file for preview (unlike
// sharing, which reuses the existing W1 temp-file posture on purpose). PDF goes
// through PDFKit, images through UIImage/NSImage, both fed straight from the
// decoded bytes still held in process memory.
enum PairedAttachmentPreviewKind: Equatable {
    case pdf(PDFDocument)
    case image(PlatformImageBox)
    case other
    case unavailable

    static func == (lhs: PairedAttachmentPreviewKind, rhs: PairedAttachmentPreviewKind) -> Bool {
        switch (lhs, rhs) {
        case (.other, .other), (.unavailable, .unavailable): return true
        case (.pdf, .pdf): return true
        case (.image(let a), .image(let b)): return a.data == b.data
        default: return false
        }
    }
}

/// Wraps the platform image type so PairedAttachmentPreviewKind stays Equatable
/// without pulling AppKit/UIKit types into comparisons directly.
struct PlatformImageBox {
    let data: Data
    #if os(macOS)
    let image: NSImage?
    #else
    let image: UIImage?
    #endif
}

enum PairedAttachmentPreviewResolver {
    /// Resolves the decrypted attachment detail into a previewable kind. Returns
    /// `.unavailable` when `data` is missing or not a decodable data URL (an
    /// undecryptable ENC value becomes nil upstream, never shown as ciphertext).
    static func resolve(_ detail: HomeBaseAttachmentDetail) -> PairedAttachmentPreviewKind {
        guard let dataURL = detail.data, let decoded = HomeBaseAttachmentDataURL.decode(dataURL) else {
            return .unavailable
        }
        let mime = decoded.mimeType.lowercased()
        if mime.contains("pdf"), let document = PDFDocument(data: decoded.bytes) {
            return .pdf(document)
        }
        if mime.hasPrefix("image/") {
            #if os(macOS)
            let image = NSImage(data: decoded.bytes)
            #else
            let image = UIImage(data: decoded.bytes)
            #endif
            return .image(PlatformImageBox(data: decoded.bytes, image: image))
        }
        return .other
    }
}

#if os(macOS)
private struct PairedPDFPreviewRepresentable: NSViewRepresentable {
    let document: PDFDocument
    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = document
        return view
    }
    func updateNSView(_ nsView: PDFView, context: Context) {
        nsView.document = document
    }
}
#else
private struct PairedPDFPreviewRepresentable: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = document
        return view
    }
    func updateUIView(_ uiView: PDFView, context: Context) {
        uiView.document = document
    }
}
#endif

/// Preview + metadata for one attachment detail. Non-previewable types (D12)
/// fall back to metadata and rely on the caller to offer sharing.
struct PairedAttachmentPreviewView: View {
    let detail: HomeBaseAttachmentDetail

    private var kind: PairedAttachmentPreviewKind {
        PairedAttachmentPreviewResolver.resolve(detail)
    }

    var body: some View {
        switch kind {
        case .pdf(let document):
            PairedPDFPreviewRepresentable(document: document)
                .frame(minHeight: 320)
                .accessibilityIdentifier("attachment-preview-pdf")
        case .image(let box):
            #if os(macOS)
            if let nsImage = box.image {
                Image(nsImage: nsImage)
                    .resizable()
                    .scaledToFit()
                    .accessibilityIdentifier("attachment-preview-image")
            } else {
                unavailableMessage
            }
            #else
            if let uiImage = box.image {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .accessibilityIdentifier("attachment-preview-image")
            } else {
                unavailableMessage
            }
            #endif
        case .other, .unavailable:
            unavailableMessage
        }
    }

    private var unavailableMessage: some View {
        Text("Anteprima non disponibile per questo tipo di file. Usa Condividi per aprirlo con un'altra app.")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("attachment-preview-unavailable")
    }
}
