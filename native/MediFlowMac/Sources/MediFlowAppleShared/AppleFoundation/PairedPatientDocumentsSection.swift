import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/* @Codex */
struct PairedPatientDocumentsSection: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @Binding var attachmentDetailCandidate: HomeBaseAttachmentSummary?
    @Binding var isPickingAttachmentFile: Bool
    @Binding var pickedPhotoItem: PhotosPickerItem?
    @Binding var attachmentPickerError: String?
    @Binding var fseValidationKind: FseValidationRecordKind
    @Binding var selectedFseTherapyId: String?
    @Binding var selectedFseObservationId: String?
    @Binding var expandedInsightId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            documentsSection
            documentInsightsSection
            followupSuggestionsSection
            fseDocumentValidationSection
        }
        .padding(12)
        .lumeSurface(zone: .field)
    }

    // MARK: - S6 (Wave 5): documenti, archivio intelligente, follow-up, FSE

    /* @Codex */
    private var documentsSection: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-documents") {
                documentsContent
            } else {
                ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-documents")
            }
        }
    }

    private var documentsContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            PairedPatientSectionHeader(model: model,
                title: "Documenti",
                subtitle: "Archivio allegati del paziente",
                systemImage: "doc.text",
                refreshIdentifier: "homebase-refresh-attachments-button"
            ) {
                Task { await model.loadSelectedPatientAttachments() }
            }

            if model.attachments.isEmpty {
                Text("Nessun documento caricato per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("documents-empty-state")
            } else {
                ForEach(model.attachments) { attachment in
                    attachmentRow(attachment)
                        .accessibilityIdentifier("attachment-row-\(attachment.id)")
                }
            }

            Divider()

            if capabilities.hasCapability("network.replica.write-documents") {
                attachmentUploadControls
            } else if let message = capabilities.unavailableMessage(for: "network.replica.write-documents") {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let pickerError = attachmentPickerError {
                Text(pickerError)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .task(id: model.selectedPatient?.id) {
            guard capabilities.hasCapability("network.replica.readonly-documents") else { return }
            await model.loadSelectedPatientAttachments()
        }
        .fileImporter(isPresented: $isPickingAttachmentFile, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            handlePickedAttachmentFile(result)
        }
        .onChange(of: pickedPhotoItem) { newItem in
            guard let newItem, let patientId = model.selectedPatient?.id else { return }
            Task { await handlePickedAttachmentPhoto(newItem, patientId: patientId) }
        }
        .sheet(item: $attachmentDetailCandidate, onDismiss: { model.dismissAttachmentDetail() }) { summary in
            attachmentDetailSheet(summary)
        }
    }

    private var attachmentUploadControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Carica documento")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Button {
                    isPickingAttachmentFile = true
                } label: {
                    Label("Scegli file", systemImage: "folder")
                }
                .font(.caption)
                .disabled(!model.canUploadAttachment)
                .accessibilityIdentifier("attachment-upload-file-button")

                PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                    Label("Scegli foto", systemImage: "photo")
                }
                .font(.caption)
                .disabled(!model.canUploadAttachment)
                .accessibilityIdentifier("attachment-upload-photo-button")
            }
            Text("Solo caricamento manuale. OCR e sintesi restano sull'home-base: il documento entra in coda in attesa.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Disponibile solo online: se il Mac non risponde, il documento non viene accodato.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func handlePickedAttachmentFile(_ result: Result<[URL], Error>) {
        attachmentPickerError = nil
        switch result {
        case .failure(let error):
            attachmentPickerError = "Selezione del file non riuscita: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first, let patientId = model.selectedPatient?.id else { return }
            let accessedScopedResource = url.startAccessingSecurityScopedResource()
            defer { if accessedScopedResource { url.stopAccessingSecurityScopedResource() } }
            do {
                let rawData = try Data(contentsOf: url)
                let mimeType = Self.mimeType(forPathExtension: url.pathExtension)
                let fileName = url.lastPathComponent
                Task {
                    await model.uploadAttachmentForSelectedPatient(
                        patientId: patientId,
                        fileName: fileName,
                        mimeType: mimeType,
                        rawData: rawData
                    )
                }
            } catch {
                attachmentPickerError = "Lettura del file non riuscita: \(error.localizedDescription)"
            }
        }
    }

    private func handlePickedAttachmentPhoto(_ item: PhotosPickerItem, patientId: String) async {
        defer { pickedPhotoItem = nil }
        do {
            guard let rawData = try await item.loadTransferable(type: Data.self) else {
                attachmentPickerError = "Lettura della foto non riuscita."
                return
            }
            attachmentPickerError = nil
            let contentType = item.supportedContentTypes.first
            let mimeType = contentType?.preferredMIMEType ?? "image/jpeg"
            let fileExtension = contentType?.preferredFilenameExtension ?? "jpg"
            let fileName = "foto-\(Int(Date().timeIntervalSince1970)).\(fileExtension)"
            await model.uploadAttachmentForSelectedPatient(
                patientId: patientId,
                fileName: fileName,
                mimeType: mimeType,
                rawData: rawData
            )
        } catch {
            attachmentPickerError = "Lettura della foto non riuscita: \(error.localizedDescription)"
        }
    }

    private static func mimeType(forPathExtension pathExtension: String) -> String {
        UTType(filenameExtension: pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func attachmentRow(_ attachment: HomeBaseAttachmentSummary) -> some View {
        Button {
            attachmentDetailCandidate = attachment
            Task { await model.openAttachmentDetail(attachment) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(attachment.name.isEmpty ? "Documento senza nome" : attachment.name)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Self.byteCountFormatter.string(fromByteCount: Int64(attachment.size)))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    Text(attachment.type)
                    if let createdAt = attachment.createdAt {
                        Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: createdAt))
                    }
                    if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: attachment.ocrQueueState, reason: attachment.ocrQueueReason) {
                        Text(queueLabel)
                            .foregroundStyle(.orange)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .modifier(LumeRigaListaModifier(isSelected: attachmentDetailCandidate?.id == attachment.id))
    }

    private func attachmentDetailSheet(_ summary: HomeBaseAttachmentSummary) -> some View {
        NavigationStack {
            Group {
                if let detail = model.selectedAttachmentDetail, detail.id == summary.id {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            PairedAttachmentPreviewView(detail: detail)
                            VStack(alignment: .leading, spacing: 4) {
                                InfoRow("Nome", detail.name)
                                InfoRow("Tipo", detail.type)
                                InfoRow("Dimensione", Self.byteCountFormatter.string(fromByteCount: Int64(detail.size)))
                                if let createdAt = detail.createdAt {
                                    InfoRow("Caricato il", PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: createdAt))
                                }
                                if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: detail.ocrQueueState, reason: detail.ocrQueueReason) {
                                    InfoRow("Stato coda OCR", queueLabel)
                                }
                                if let summarySnapshot = cleanedPatientWorkspaceValue(detail.summarySnapshot) {
                                    InfoRow("Sintesi", summarySnapshot)
                                }
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
                        .padding(20)
                    }
                } else if model.isWorking {
                    ProgressView("Caricamento documento...")
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
                    Button("Chiudi") { attachmentDetailCandidate = nil }
                }
            }
        }
    }

    /* @Codex */
    private var documentInsightsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Archivio Intelligente", systemImage: "text.magnifyingglass")
                .font(.subheadline.weight(.semibold))
            if model.documentInsights.isEmpty {
                Text("Nessun documento analizzato per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("document-insights-empty-state")
            } else {
                Text("Ultimi \(model.documentInsights.count) documenti analizzati")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(model.documentInsights) { insight in
                    documentInsightRow(insight)
                        .accessibilityIdentifier("document-insight-row-\(insight.id)")
                }
            }

            if !model.evidenceStackInsights.isEmpty {
                Divider()
                Text("Referti recenti")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(model.evidenceStackInsights) { insight in
                    evidenceStackTile(insight)
                        .accessibilityIdentifier("evidence-stack-tile-\(insight.id)")
                }
            }

            Text("Sintesi generata da IA locale sull'host. Verificare sempre. Nessuna azione di scrittura disponibile da qui: curation e cancellazione restano sul web.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func documentInsightRow(_ insight: ClinicalDocumentInsight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                expandedInsightId = expandedInsightId == insight.id ? nil : insight.id
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(insight.fileName)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            if let dateLabel = Self.insightDateLabel(insight) {
                                Text(dateLabel)
                            }
                            if let quality = insight.qualityLevel {
                                Text(Self.documentQualityLabel(quality))
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: expandedInsightId == insight.id ? "chevron.up" : "chevron.down")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if expandedInsightId == insight.id {
                VStack(alignment: .leading, spacing: 4) {
                    if !insight.extractedDiagnoses.isEmpty {
                        Text(insight.extractedDiagnoses
                            .map { "\($0.system.map { s in "\(s) " } ?? "")\($0.code) - \($0.description)" }
                            .joined(separator: " \u{00B7} "))
                            .font(.caption2)
                    }
                    if !insight.extractedMedications.isEmpty {
                        Text("Terapie: \(insight.extractedMedications.joined(separator: ", "))")
                            .font(.caption2)
                    }
                    if let reason = insight.qualityReason {
                        Text("Qualita documento: \(reason)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !insight.appliedDiagnoses.isEmpty {
                        Text("Diagnosi aggiunte alla scheda: \(insight.appliedDiagnoses.joined(separator: ", "))")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                    if !insight.summary.isEmpty {
                        Text(insight.summary)
                            .font(.caption)
                    }
                }
                .padding(.leading, 8)
            }
        }
    }

    private func evidenceStackTile(_ insight: ClinicalDocumentInsight) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(insight.fileName)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let quality = insight.qualityLevel {
                    Text(Self.documentQualityLabel(quality))
                        .font(.caption2.weight(.semibold))
                }
            }
            if let dateLabel = Self.insightDateLabel(insight) {
                Text(dateLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(insight.summary.isEmpty ? "Documento acquisito e pronto per revisione contestuale." : insight.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack(spacing: 8) {
                Text("\(insight.extractedDiagnoses.count) diagnosi")
                Text("\(insight.extractedMedications.count) terapie")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(10)
        .lumeSurface(zone: .field, cornerRadius: 12)
    }

    /* @Codex */
    private var followupSuggestionsSection: some View {
        Group {
            if !model.followupSuggestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Trovati nei documenti, da valutare")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(model.followupSuggestions) { suggestion in
                        followupSuggestionRow(suggestion)
                            .accessibilityIdentifier("followup-suggestion-row-\(suggestion.id)")
                    }
                }
            }
        }
    }

    private func followupSuggestionRow(_ suggestion: FollowupSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(suggestion.label)
                .font(.caption.weight(.semibold))
            if !suggestion.excerpt.isEmpty {
                Text(suggestion.excerpt)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Trovato in \(suggestion.citation.fileName)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button {
                    model.prefillNewCheckupFromFollowup(suggestion)
                } label: {
                    Label("Crea follow-up", systemImage: "calendar.badge.plus")
                }
                .font(.caption)
                .accessibilityIdentifier("followup-create-checkup-button-\(suggestion.id)")
            }
        }
        .padding(10)
        .lumeSurface(zone: .field, cornerRadius: 10)
    }

    /* @Codex */
    private var fseDocumentValidationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Verifica FSE documento singolo", systemImage: "checkmark.seal")
                .font(.subheadline.weight(.semibold))
            Text("Controlla una terapia o un'osservazione gia caricata contro il profilo FSE corrispondente, prima dell'export completo.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Disponibile solo online.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Picker("Tipo record", selection: $fseValidationKind) {
                ForEach(FseValidationRecordKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("fse-document-validation-kind")
            .onChange(of: fseValidationKind) { _ in model.dismissFseDocumentValidation() }

            switch fseValidationKind {
            case .therapy:
                if model.therapies.isEmpty {
                    Text("Nessuna terapia caricata da verificare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Terapia", selection: $selectedFseTherapyId) {
                        Text("Seleziona...").tag(String?.none)
                        ForEach(model.therapies) { therapy in
                            Text(therapy.drugName).tag(Optional(therapy.id))
                        }
                    }
                    .accessibilityIdentifier("fse-document-validation-therapy-picker")
                    Button("Verifica") {
                        guard let therapy = model.therapies.first(where: { $0.id == selectedFseTherapyId }) else { return }
                        Task { await model.validateFseTherapy(therapy) }
                    }
                    .font(.caption)
                    .disabled(selectedFseTherapyId == nil || model.isWorking || model.connectionState != .pairedOnline)
                    .accessibilityIdentifier("fse-document-validation-run-button")
                }
            case .observation:
                if model.observations.isEmpty {
                    Text("Nessuna osservazione caricata da verificare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Osservazione", selection: $selectedFseObservationId) {
                        Text("Seleziona...").tag(String?.none)
                        ForEach(model.observations) { observation in
                            Text(observation.display).tag(Optional(observation.id))
                        }
                    }
                    .accessibilityIdentifier("fse-document-validation-observation-picker")
                    Button("Verifica") {
                        guard let observation = model.observations.first(where: { $0.id == selectedFseObservationId }) else { return }
                        Task { await model.validateFseObservation(observation) }
                    }
                    .font(.caption)
                    .disabled(selectedFseObservationId == nil || model.isWorking || model.connectionState != .pairedOnline)
                    .accessibilityIdentifier("fse-document-validation-run-button")
                }
            }

            if let result = model.fseDocumentValidationResult {
                fseDocumentValidationResultView(result)
            }
        }
    }

    private func fseDocumentValidationResultView(_ result: HomeBaseFseDocumentValidationResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(result.ok ? .green : .orange)
                Text(model.fseDocumentValidationTargetLabel ?? result.profile)
                    .font(.caption.weight(.semibold))
            }
            if result.errors.isEmpty && result.warnings.isEmpty {
                Text("Nessun errore o avviso per il profilo \(result.profile).")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(result.errors.enumerated()), id: \.offset) { _, issue in
                    Text("Errore: \(issue.message)")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
                ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in
                    Text("Avviso: \(issue.message)")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
        .accessibilityIdentifier("fse-document-validation-result")
    }

    private static func documentQualityLabel(_ level: String) -> String {
        switch level.lowercased() {
        case "green": return "Buona"
        case "yellow": return "Da verificare"
        case "red": return "Critica"
        default: return level
        }
    }

    private static func insightDateLabel(_ insight: ClinicalDocumentInsight) -> String? {
        let raw = insight.documentDate ?? insight.date
        guard !raw.isEmpty else { return nil }
        guard let parsed = HomeBaseDateCoding.parseISO8601(raw) else { return raw }
        return PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: parsed)
    }

    private static let byteCountFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()

    /* @Codex */
}
