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

    @State private var isShowingUpload = false

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            documentsSection

            // @Codex: the empty archive starts with upload, not empty analyses.
            if !model.attachments.isEmpty || !model.documentInsights.isEmpty || !model.evidenceStackInsights.isEmpty {
                Divider()
                DisclosureGroup {
                    documentInsightsSection
                        .padding(.top, 12)
                } label: {
                    Text("Sintesi dei documenti")
                        .font(.headline)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("documents-insights-disclosure")
            }

            followupSuggestionsSection

            Divider()
            DisclosureGroup {
                fseDocumentValidationSection
                    .padding(.top, 12)
            } label: {
                Text("Verifica FSE")
                    .font(.headline)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("documents-fse-disclosure")
        }
        .padding(ClinicalChartMetrics.cardPadding)
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
                subtitle: "",
                systemImage: "doc.text",
                refreshIdentifier: "homebase-refresh-attachments-button",
                itemCount: model.attachmentsLoadState == .loaded ? model.attachments.count : nil,
                accent: .documenti
            ) {
                Task { await model.loadSelectedPatientAttachments() }
            }

            attachmentList

            if capabilities.hasCapability("network.replica.write-documents") {
                if model.attachmentsLoadState == .loaded && model.attachments.isEmpty {
                    attachmentUploadControls
                } else {
                    DisclosureGroup(isExpanded: $isShowingUpload) {
                        attachmentUploadControls
                            .padding(.top, 12)
                    } label: {
                        Label("Aggiungi documento", systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("attachment-upload-disclosure")
                }
            } else if let message = capabilities.unavailableMessage(for: "network.replica.write-documents") {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let pickerError = attachmentPickerError {
                Text(pickerError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .fileImporter(isPresented: $isPickingAttachmentFile, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            handlePickedAttachmentFile(result)
        }
        .onChange(of: pickedPhotoItem) { newItem in
            guard let newItem, let patientId = model.selectedPatient?.id else { return }
            Task { await handlePickedAttachmentPhoto(newItem, patientId: patientId) }
        }
    }

    /* @Codex: reuse the shared distinction between unread and genuinely empty. */
    @ViewBuilder
    private var attachmentList: some View {
        switch ClinicalWorkspaceSectionContent(
            state: model.attachmentsLoadState,
            isEmpty: model.attachments.isEmpty,
            idleMessage: "Documenti non ancora letti.",
            emptyMessage: "Nessun documento caricato per questo paziente."
        ) {
        case .progress:
            ProgressView("Caricamento documenti…")
                .accessibilityIdentifier("documents-loading-state")
        case .message(let message):
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(model.attachmentsLoadState == .loaded ? "documents-empty-state" : "documents-read-state")
        case .rows:
            ForEach(model.attachments) { attachment in
                attachmentRow(attachment)
                    .accessibilityIdentifier("attachment-row-\(attachment.id)")
            }
        }
    }

    private var attachmentUploadControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { attachmentSourceButtons }
                    .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 12) { attachmentSourceButtons }
            }
            Text("Carica un file o una foto. Il collegamento al Mac deve essere attivo.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("Testo estratto, immagini e scansioni richiedono revisione.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var attachmentSourceButtons: some View {
        Button {
            isPickingAttachmentFile = true
        } label: {
            Label("Scegli file", systemImage: "folder")
                .frame(minHeight: 44)
        }
        .disabled(!model.canUploadAttachment)
        .accessibilityIdentifier("attachment-upload-file-button")

        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
            Label("Scegli foto", systemImage: "photo")
                .frame(minHeight: 44)
        }
        .disabled(!model.canUploadAttachment)
        .accessibilityIdentifier("attachment-upload-photo-button")
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
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(attachment.name.isEmpty ? "Documento senza nome" : attachment.name)
                        .chartRowTitle()
                        .fixedSize(horizontal: false, vertical: true)
                    if let createdAt = attachment.createdAt {
                        Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: createdAt))
                            .font(.subheadline)
                            .registro()
                    }
                    Text("\(attachment.type) · \(Self.byteCountFormatter.string(fromByteCount: Int64(attachment.size)))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: attachment.ocrQueueState, reason: attachment.ocrQueueReason) {
                        Text(queueLabel)
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(LumeRigaListaModifier(isSelected: attachmentDetailCandidate?.id == attachment.id))
    }

    /* @Codex */
    private var documentInsightsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.documentInsights.isEmpty {
                Text("Nessun documento analizzato per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("document-insights-empty-state")
            } else {
                Text("Ultimi \(model.documentInsights.count) documenti analizzati")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(model.documentInsights) { insight in
                    documentInsightRow(insight)
                        .accessibilityIdentifier("document-insight-row-\(insight.id)")
                }
            }

            if !model.evidenceStackInsights.isEmpty {
                Divider()
                Text("Referti recenti")
                    .chartGroupHeading()
                ForEach(model.evidenceStackInsights) { insight in
                    evidenceStackTile(insight)
                        .accessibilityIdentifier("evidence-stack-tile-\(insight.id)")
                }
            }

            Text("Sintesi IA generata sul Mac, da verificare. Revisione e cancellazione sono disponibili nell’app web.")
                .font(.callout)
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
                            .chartRowTitle()
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            if let dateLabel = Self.insightDateLabel(insight) {
                                Text(dateLabel)
                            }
                            if let quality = insight.qualityLevel {
                                Text(Self.documentQualityLabel(quality))
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: expandedInsightId == insight.id ? "chevron.up" : "chevron.down")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // The chevron was the only thing describing this control: nothing in
            // the accessibility tree said the row expanded, or whether it was open.
            .accessibilityLabel("\(insight.fileName). Dettagli documento")
            .accessibilityValue(expandedInsightId == insight.id ? "Espanso" : "Compresso")
            .accessibilityHint("Mostra o nasconde diagnosi e terapie estratte dal documento.")
            .accessibilityIdentifier("document-insight-disclosure-\(insight.id)")

            if expandedInsightId == insight.id {
                VStack(alignment: .leading, spacing: 4) {
                    if !insight.extractedDiagnoses.isEmpty {
                        Text(insight.extractedDiagnoses
                            .map { "\($0.system.map { s in "\(s) " } ?? "")\($0.code) - \($0.description)" }
                            .joined(separator: " \u{00B7} "))
                            .font(.caption)
                    }
                    if !insight.extractedMedications.isEmpty {
                        Text("Terapie: \(insight.extractedMedications.joined(separator: ", "))")
                            .font(.caption)
                    }
                    if let reason = insight.qualityReason {
                        Text("Qualita documento: \(reason)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !insight.appliedDiagnoses.isEmpty {
                        Text("Diagnosi aggiunte alla scheda: \(insight.appliedDiagnoses.joined(separator: ", "))")
                            .font(.caption.weight(.semibold))
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
                    .chartRowTitle()
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if let quality = insight.qualityLevel {
                    Text(Self.documentQualityLabel(quality))
                        .font(.caption.weight(.semibold))
                }
            }
            if let dateLabel = Self.insightDateLabel(insight) {
                Text(dateLabel)
                    .font(.caption)
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
            .font(.caption)
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
                        .chartGroupHeading()
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
                .chartRowTitle()
            if !suggestion.excerpt.isEmpty {
                Text(suggestion.excerpt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Trovato in \(suggestion.citation.fileName)")
                    .font(.caption)
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
            Text("Controlla una terapia o un’osservazione rispetto al profilo FSE prima dell’export. Disponibile online.")
                .font(.callout)
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
                        .font(.caption)
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
                        .font(.caption)
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
                    .chartRowTitle()
            }
            if result.errors.isEmpty && result.warnings.isEmpty {
                Text("Nessun errore o avviso per il profilo \(result.profile).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(result.errors.enumerated()), id: \.offset) { _, issue in
                    Text("Errore: \(issue.message)")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in
                    Text("Avviso: \(issue.message)")
                        .font(.caption)
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
