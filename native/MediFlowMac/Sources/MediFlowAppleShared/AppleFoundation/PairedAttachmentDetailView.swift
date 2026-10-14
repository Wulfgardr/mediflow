import SwiftUI

/* @Codex */
/// Mounted by the workspace so diary and archive share the same presentation.
struct PairedAttachmentDetailView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let summary: HomeBaseAttachmentSummary
    let onClose: () -> Void
    var isEmbedded = false

    var body: some View {
        Group {
            if isEmbedded {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(summary.name.isEmpty ? "Documento" : summary.name)
                            .font(.headline).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Button("Chiudi", systemImage: "xmark", action: onClose)
                            .labelStyle(.iconOnly)
                    }.padding(16)
                    Divider()
                    document
                }
                .background(PlatformColors.chartCardSurface)
            } else {
                NavigationStack {
                    document
                        .navigationTitle(summary.name.isEmpty ? "Documento" : summary.name)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Chiudi", action: onClose)
                            }
                        }
                }
            }
        }
    }

    @ViewBuilder
    private var document: some View {
        if let detail = model.selectedAttachmentDetail, detail.id == summary.id {
            detailContent(detail)
        } else if model.isWorking {
            ProgressView("Caricamento documento…").padding(20)
        } else {
            Text("Documento non disponibile.").foregroundStyle(.secondary).padding(20)
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
