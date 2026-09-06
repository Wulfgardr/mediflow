import SwiftUI

/* @Codex */
/// Mounted by the workspace so diary and archive share the same presentation.
struct PairedAttachmentDetailView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let summary: HomeBaseAttachmentSummary
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let detail = model.selectedAttachmentDetail, detail.id == summary.id {
                    detailContent(detail)
                } else if model.isWorking {
                    ProgressView("Caricamento documento…")
                        .padding(20)
                } else {
                    Text("Documento non disponibile.")
                        .foregroundStyle(.secondary)
                        .padding(20)
                }
            }
            .navigationTitle(summary.name.isEmpty ? "Documento" : summary.name)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Chiudi", action: onClose)
                }
            }
        }
    }

    private func detailContent(_ detail: HomeBaseAttachmentDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PairedAttachmentPreviewView(detail: detail)

                if let summarySnapshot = cleanedPatientWorkspaceValue(detail.summarySnapshot) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Sintesi").font(.headline)
                        Text(summarySnapshot).chartProse()
                    }
                }

                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        InfoRow("Nome", detail.name)
                        InfoRow("Tipo", detail.type)
                        InfoRow("Dimensione", Self.byteCountFormatter.string(fromByteCount: Int64(detail.size)))
                        if let createdAt = detail.createdAt {
                            InfoRow("Caricato il", PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: createdAt))
                        }
                        if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: detail.ocrQueueState, reason: detail.ocrQueueReason) {
                            InfoRow("Stato revisione documento", queueLabel)
                        }
                    }
                    .padding(.top, 12)
                } label: {
                    Text("Informazioni sul file").font(.headline)
                }

                if let shareURL = model.attachmentShareURL {
                    ShareLink(item: shareURL) {
                        Label("Condividi", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("attachment-share-link")
                } else {
                    Button {
                        model.prepareAttachmentShareFile()
                    } label: {
                        Label("Prepara condivisione", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("attachment-prepare-share-button")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }

    private static let byteCountFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()
}
