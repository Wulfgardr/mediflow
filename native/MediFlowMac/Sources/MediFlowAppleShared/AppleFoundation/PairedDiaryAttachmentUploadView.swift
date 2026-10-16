import SwiftUI
import UniformTypeIdentifiers

struct PairedDiaryAttachmentUploadView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var batch = PairedAttachmentImportBatch()
    @State private var isPicking = false
    @State private var selection: Selection?
    @State private var generation = UUID()
    @State private var pickerError: String?

    private struct Selection {
        let patientId: String
        let identity: ClinicalWorkspaceConnection.Identity
        let generation: UUID
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                guard let patientId = model.selectedPatientID,
                      let identity = model.clinicalWorkspaceConnection?.identity else { return }
                selection = Selection(patientId: patientId, identity: identity, generation: generation)
                pickerError = nil
                isPicking = true
            } label: {
                Label("Allega nuovi file", systemImage: "paperclip.badge.ellipsis")
                    .frame(minHeight: 44)
            }
            .disabled(!model.canUploadAttachment || batch.isRunning)
            .accessibilityIdentifier("diary-upload-new-files")
            Text("I documenti confermati vengono salvati nell’archivio e collegati alla bozza. Restano nell’archivio anche se non registri la voce.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            ForEach(batch.results) { result in
                Text("\(result.fileName): \(result.message)")
                    .font(.footnote)
                    .accessibilityIdentifier("diary-upload-result-\(result.id)")
            }
            if !batch.results.isEmpty {
                Button("Aggiorna elenco documenti") { Task { await model.loadSelectedPatientAttachments() } }
                    .disabled(model.isWorking || batch.isRunning)
                    .accessibilityIdentifier("diary-upload-refresh-documents")
            }
            if batch.isRunning {
                Button(batch.isStopping ? "Interruzione in corso…" : "Interrompi caricamento") { batch.stop() }
                    .disabled(batch.isStopping)
                    .accessibilityIdentifier("diary-upload-stop")
            }
            if let message = pickerError ?? model.errorMessage {
                Text(message).foregroundStyle(LumePalette.critical).font(.footnote)
            }
        }
        .fileImporter(isPresented: $isPicking, allowedContentTypes: [.item], allowsMultipleSelection: true,
                      onCompletion: handleSelection)
        .onDisappear { invalidate() }
        .onChange(of: model.selectedPatientID) { _ in invalidate() }
        .onReceive(model.clinicalWorkspaceInvalidations) { _ in invalidate() }
        .onChange(of: scenePhase) { if $0 == .background { invalidate() } }
    }

    private func invalidate() {
        generation = UUID()
        selection = nil
        isPicking = false
        pickerError = nil
        batch.cancel()
    }

    private func handleSelection(_ result: Result<[URL], Error>) {
        guard let captured = selection else { return }
        selection = nil
        let isCurrent = {
            generation == captured.generation && model.selectedPatientID == captured.patientId
                && model.clinicalWorkspaceConnection?.identity == captured.identity
        }
        guard isCurrent() else { return }
        switch result {
        case .failure(let error): pickerError = "Selezione dei file non riuscita: \(error.localizedDescription)"
        case .success(let urls):
            batch.start(urls, isCurrent: isCurrent) { url in
                guard isCurrent(), model.canUploadAttachment else { throw CancellationError() }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                   HomeBaseAttachmentWirePrecheck.check(rawByteCount: size).exceedsLimit {
                    throw CocoaError(.fileReadTooLarge)
                }
                var bytes = try Data(contentsOf: url)
                defer { bytes.resetBytes(in: 0..<bytes.count) }
                return await model.uploadAttachmentForNewEntryDraft(patientId: captured.patientId,
                    fileName: url.lastPathComponent,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                    rawData: bytes, isCurrent: isCurrent)
            }
        }
    }
}

extension PairedPatientsWorkspaceModel {
    func uploadAttachmentForNewEntryDraft(patientId: String, fileName: String, mimeType: String,
                                          rawData: Data, isCurrent: @escaping () -> Bool) async -> PairedAttachmentUploadOutcome {
        guard isCurrent() else { return .unconfirmed }
        return await uploadAttachmentForSelectedPatient(patientId: patientId, fileName: fileName,
            mimeType: mimeType, rawData: rawData) { attachmentId in
                guard isCurrent() else { return }
                self.newEntryAttachmentIds.insert(attachmentId)
            }
    }
}
