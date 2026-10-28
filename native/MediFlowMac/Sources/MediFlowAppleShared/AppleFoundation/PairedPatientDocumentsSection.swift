import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

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

    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var importBatch = PairedAttachmentImportBatch()
    @State private var isShowingUpload = false
    var usesInlinePreview = false

    var body: some View {
        Group {
            if usesInlinePreview, let attachment = attachmentDetailCandidate {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        archiveColumn.frame(width: 240, alignment: .topLeading)
                        Divider()
                        original(attachment).frame(width: 399)
                    }.frame(width: 680, alignment: .leading)
                    VStack(alignment: .leading, spacing: 20) {
                        archiveColumn
                        Divider()
                        original(attachment)
                    }
                }
            } else { archiveColumn }
        }
        .onDisappear { importBatch.cancel() }
        .onChange(of: model.selectedPatientID) { _ in importBatch.cancel() }
        .onReceive(model.clinicalWorkspaceInvalidations) { _ in importBatch.cancel() }
        .onChange(of: scenePhase) { phase in if phase == .background { importBatch.cancel() } }
    }

    private func original(_ attachment: HomeBaseAttachmentSummary) -> some View {
        PairedAttachmentDetailView(model: model, summary: attachment, onClose: {
            attachmentDetailCandidate = nil
            model.dismissAttachmentDetail()
        }, isEmbedded: true)
        .frame(height: 560)
        .accessibilityIdentifier("documents-original-preview")
    }

    private var archiveColumn: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            documentsSection

            // the empty archive starts with upload, not empty analyses.
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

            if capabilities.hasCapability("network.replica.readonly-documents") {
                Divider()
                NativeDocumentSynthesisView(workspaceModel: model)
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

    }

    // MARK: - S6 (Wave 5): documenti, archivio intelligente, follow-up, FSE

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

            if !importBatch.results.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(importBatch.results) { result in
                        Text("\(result.fileName): \(result.message)").font(.caption)
                    }
                    if importBatch.isRunning {
                        Button(importBatch.isStopping ? "Verifica esito in corso…" : "Interrompi importazione") { importBatch.stop() }
                            .disabled(importBatch.isStopping)
                    }
                }.accessibilityIdentifier("attachment-import-results")
            }

            if let pickerError = attachmentPickerError {
                Text(pickerError)
                    .font(.caption)
                    .foregroundStyle(LumePalette.critical)
            }
        }
        .fileImporter(isPresented: $isPickingAttachmentFile, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            handlePickedAttachmentFile(result)
        }
        .onChange(of: pickedPhotoItem) { newItem in
            guard let newItem, let patientId = model.selectedPatient?.id else { return }
            Task { await handlePickedAttachmentPhoto(newItem, patientId: patientId) }
        }
    }

    /* reuse the shared distinction between unread and genuinely empty. */
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
        .disabled(!model.canUploadAttachment || importBatch.isRunning)
        .accessibilityIdentifier("attachment-upload-file-button")

        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
            Label("Scegli foto", systemImage: "photo")
                .frame(minHeight: 44)
        }
        .disabled(!model.canUploadAttachment || importBatch.isRunning)
        .accessibilityIdentifier("attachment-upload-photo-button")
    }

    private func handlePickedAttachmentFile(_ result: Result<[URL], Error>) {
        attachmentPickerError = nil
        switch result {
        case .failure(let error):
            attachmentPickerError = "Selezione dei file non riuscita: \(error.localizedDescription)"
        case .success(let urls):
            guard let patientId = model.selectedPatientID, let identity = model.clinicalWorkspaceConnection?.identity else { return }
            let current = {
                model.selectedPatientID == patientId && model.clinicalWorkspaceConnection?.identity == identity
            }
            importBatch.start(urls, isCurrent: current) { url in
                guard current(), model.canUploadAttachment else { throw CancellationError() }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                   HomeBaseAttachmentWirePrecheck.check(rawByteCount: size).exceedsLimit {
                    throw CocoaError(.fileReadTooLarge)
                }
                var bytes = try Data(contentsOf: url)
                defer { bytes.resetBytes(in: 0..<bytes.count) }
                return await model.uploadAttachmentForSelectedPatient(patientId: patientId,
                    fileName: url.lastPathComponent, mimeType: Self.mimeType(forPathExtension: url.pathExtension), rawData: bytes)
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
                            .foregroundStyle(LumePalette.warning)
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

    private var documentInsightsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if DocumentInsightsCodec.decodeResult(model.selectedPatient?.documentInsights).isUnreadable {
                Label(PatientStructuredFields.unreadableMessage("Informazioni dai documenti"), systemImage: "lock.fill")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("document-insights-unreadable-state")
            } else if model.documentInsights.isEmpty {
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
                            .foregroundStyle(LumePalette.success)
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
        .padding(.vertical, 12)
        .modifier(LumeRigaListaModifier(isSelected: false))
    }

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
        .padding(.vertical, 12)
        .modifier(LumeRigaListaModifier(isSelected: false))
    }

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
                        .foregroundStyle(LumePalette.critical)
                }
                ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in
                    Text("Avviso: \(issue.message)")
                        .font(.caption)
                        .foregroundStyle(LumePalette.warning)
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

}

enum PairedAttachmentUploadOutcome { case uploaded, uploadedNeedsRefresh, unconfirmed }

@MainActor
final class PairedAttachmentImportBatch: ObservableObject {
    struct Result: Identifiable {
        let id: Int
        let fileName: String
        var message: String
    }
    @Published private(set) var results: [Result] = []
    @Published private(set) var isRunning = false
    @Published private(set) var isStopping = false
    private var currentIndex: Int?
    private var generation: UInt = 0
    private var inFlight = false
    private var task: Task<Void, Never>?

    func start(_ urls: [URL], isCurrent: @escaping () -> Bool,
               upload: @escaping (URL) async throws -> PairedAttachmentUploadOutcome) {
        guard !isRunning, !inFlight, !urls.isEmpty, isCurrent() else { return }
        generation &+= 1
        let epoch = generation
        results = urls.enumerated().map { Result(id: $0.offset, fileName: $0.element.lastPathComponent, message: "Non avviato") }
        isRunning = true; inFlight = true; isStopping = false
        task = Task {
            defer {
                inFlight = false
                if generation == epoch { isRunning = false; isStopping = false; currentIndex = nil }
            }
            for (index, url) in urls.enumerated() {
                guard generation == epoch, isCurrent() else {
                    if generation == epoch { cancel() }
                    return
                }
                guard !isStopping, !Task.isCancelled else { return }
                currentIndex = index
                results[index].message = "Caricamento in corso…"
                do {
                    let outcome = try await upload(url)
                    guard generation == epoch, isCurrent() else {
                        if generation == epoch { cancel() }
                        return
                    }
                    switch outcome {
                    case .uploaded:
                        results[index].message = "Caricato"
                        if isStopping || Task.isCancelled { return }
                    case .uploadedNeedsRefresh:
                        results[index].message = "Caricato; ricarica l’archivio prima di proseguire."
                        return
                    case .unconfirmed:
                        results[index].message = "Esito non confermato: verifica l’archivio prima di riprovare."
                        return
                    }
                } catch {
                    guard generation == epoch, isCurrent() else {
                        if generation == epoch { cancel() }
                        return
                    }
                    results[index].message = isStopping || error is CancellationError
                        ? "Esito non confermato: verifica l’archivio prima di riprovare."
                        : "Importazione interrotta: \(error.localizedDescription)"
                    return
                }
            }
        }
    }
    func stop() {
        guard inFlight, !isStopping else { return }
        isStopping = true
        if let currentIndex {
            results[currentIndex].message = "Interruzione richiesta: esito non ancora confermato."
        }
        task?.cancel()
    }
    func cancel() {
        generation &+= 1
        task?.cancel(); task = nil
        results = []; isRunning = false; isStopping = false; currentIndex = nil
    }
}
