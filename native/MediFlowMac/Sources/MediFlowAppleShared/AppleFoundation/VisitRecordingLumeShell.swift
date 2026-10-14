/* @Codex */
#if os(macOS)
import MediFlowCore
import SwiftUI

/// The workspace mounts this once outside its patient-section identities.
/// A hidden recorder can retain final review text, never running capture.
@MainActor
struct VisitRecordingWorkspaceScope: ViewModifier {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @StateObject private var coordinator = VisitRecordingLumeCoordinator()
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .environmentObject(coordinator)
            .task(id: model.visitRecordingWorkspaceContext) {
                await coordinator.ownerDidChange(to: model.visitRecordingWorkspaceContext?.binding)
            }
            .onChange(of: scenePhase) { phase in
                guard phase != .active else { return }
                Task { await coordinator.suspendForNavigation() }
            }
            .onDisappear {
                Task { await coordinator.cancelForLifecycle() }
            }
    }
}

@MainActor
struct VisitRecordingLumeShell: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let onTransferTranscript: @MainActor (String) -> Void
    @EnvironmentObject private var coordinator: VisitRecordingLumeCoordinator
    @Environment(\.openURL) private var openURL
    @State private var replacementCandidate: VisitRecordingLumeCoordinator.TranscriptReplacement?
    @State private var transferNeedsReview = false

    private var ownerBinding: VisitRecordingOwnerBinding? {
        model.visitRecordingWorkspaceContext?.binding
    }

    var body: some View {
        Group {
            if #available(macOS 26.0, *) {
                supportedContent
            }
        }
        .padding(12)
        .lumeSurface(zone: .field, cornerRadius: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("clinical-workspace-visit-recording")
        .task(id: ownerBinding) {
            await coordinator.ownerDidChange(to: ownerBinding)
        }
        .onChange(of: coordinator.state) { state in
            if state != .transcriptReview { replacementCandidate = nil }
        }
        .onDisappear {
            replacementCandidate = nil
            transferNeedsReview = false
            Task { await coordinator.suspendForNavigation() }
        }
        .confirmationDialog(
            "Sostituire il testo già presente?",
            isPresented: Binding(
                get: { replacementCandidate != nil },
                set: { if !$0 { replacementCandidate = nil } }
            ),
            titleVisibility: .visible,
            presenting: replacementCandidate
        ) { candidate in
            Button("Sostituisci il testo", role: .destructive) {
                transferTranscript(confirmedReplacement: candidate)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-confirm-replacement")
            Button("Mantieni entrambi", role: .cancel) { }
        } message: { _ in
            Text("Il campo contiene già una trascrizione. Puoi mantenere entrambi i testi separati oppure sostituire il campo con questa registrazione. La bozza clinica richiederà ancora revisione e conferma.")
        }
    }

    @ViewBuilder
    private var supportedContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Ascolto della visita", systemImage: "mic")
                .font(.caption.weight(.semibold))

            switch coordinator.state {
            case .disclosure:
                disclosureContent
            case .requestingPermission:
                progressContent("Attendo il consenso del sistema e verifico gli asset locali.")
            case .installationRequired:
                installationContent
            case .installing:
                progressContent("Installazione locale in corso…")
            case .ready:
                readyContent
            case .starting:
                progressContent("Avvio dell’ascolto…")
            case .recording:
                recordingContent
            case .finalizing:
                progressContent("Trascrizione in corso…")
            case .transcriptReview:
                transcriptReviewContent
            case .completed:
                Label("Trascrizione portata nel campo di revisione. Rivedila prima di registrare.", systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(LumePalette.success)
            case .permissionDenied:
                permissionDeniedContent
            case .unavailable:
                unavailableContent("L’ascolto non è disponibile su questo computer. Puoi scrivere la voce a mano.")
            case let .denied(denial):
                unavailableContent(denialMessage(denial))
            }

            if coordinator.canBeginNewSession {
                Button("Nuovo ascolto") {
                    coordinator.beginNewSessionAfterExplicitRequest()
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("clinical-workspace-visit-recording-new-session")
            }
        }
    }

    private var disclosureContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("L’audio viene elaborato solo su questo computer e non viene salvato. La trascrizione arriva a matita: resta una proposta finché non la porti nella voce. Informa il paziente prima di cominciare.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                let acceptedContext = model.visitRecordingWorkspaceContext
                Task {
                    await coordinator.acceptDisclosure(for: acceptedContext?.binding) {
                        guard model.visitRecordingWorkspaceContext == acceptedContext else { return nil }
                        return model.visitRecordingWorkspaceContext?.binding
                    }
                }
            } label: {
                Label("Consenti microfono e continua", systemImage: "mic.badge.plus")
                    .frame(minHeight: 44)
            }
            .disabled(ownerBinding == nil)
            .accessibilityIdentifier("clinical-workspace-visit-recording-disclosure-accept")
        }
    }

    private var installationContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("La lingua italiana non è installata. Il download parte solo con l'azione seguente.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                Task { await coordinator.installAssets() }
            } label: {
                Label("Installa la lingua italiana", systemImage: "arrow.down.circle")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-install-assets")
        }
    }

    private var readyContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Microfono e lingua italiana sono pronti. L’avvio resta manuale. Durata massima 90 minuti.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                Task { await coordinator.start() }
            } label: {
                Label("Ascolta la visita", systemImage: "mic")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-start")
        }
    }

    private var recordingContent: some View {
        HStack(spacing: 12) {
            Label("In ascolto", systemImage: "circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PlatformColors.pencil)
                .accessibilityLabel("In ascolto. Solo su questo computer, audio non salvato")
            Spacer(minLength: 8)
            Button {
                Task { await coordinator.stop() }
            } label: {
                Label("Ferma l’ascolto", systemImage: "stop.fill")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-stop")
        }
    }

    private var transcriptReviewContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rivedi la trascrizione finale. Cambiando sezione resta qui, separata dal campo trascrizione. Nessuna bozza clinica viene generata automaticamente.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Label("Trascrizione da rivedere · Proposta", systemImage: "circle")
                .foregroundStyle(PlatformColors.pencil)
            TextEditor(text: $coordinator.reviewText)
                #if os(macOS)
                .inkRegister()
                #else
                .inkVoice(17, relativeTo: .body)
                #endif
                .foregroundStyle(PlatformColors.pencil)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(PlatformColors.pencil, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 90)
                .clinicalMultilineFieldShape()
                .accessibilityIdentifier("clinical-workspace-visit-recording-review")
            HStack {
                Text("\(coordinator.reviewText.count)/\(PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars)")
                    .font(.caption2)
                    .foregroundStyle(
                        coordinator.reviewText.count <= PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
                            && coordinator.reviewTextUTF8ByteCount <= VisitRecordingLimits.standard.maxTranscriptUTF8Bytes
                            ? Color.secondary : LumePalette.critical
                    )
                Spacer(minLength: 8)
                Button {
                    transferNeedsReview = false
                    let existingText = model.newEntryVisitTranscript
                    if !existingText.isEmpty, existingText != coordinator.reviewText {
                        replacementCandidate = VisitRecordingLumeCoordinator.TranscriptReplacement(
                            existingText: existingText, reviewText: coordinator.reviewText
                        )
                    } else {
                        transferTranscript()
                    }
                } label: {
                    Label("Usa nel campo trascrizione", systemImage: "text.insert")
                        .frame(minHeight: 44)
                }
                .disabled(!coordinator.canTransferTranscript(
                    maxCharacters: PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
                ))
                .accessibilityIdentifier("clinical-workspace-visit-recording-transfer")
            }
            if transferNeedsReview {
                Text("Il testo o il contesto è cambiato. Rivedi la trascrizione e ripeti il trasferimento.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button("Scarta la trascrizione", role: .destructive) {
                Task { await coordinator.cancelForLifecycle() }
            }
            .frame(minHeight: 44)
            .accessibilityIdentifier("clinical-workspace-visit-recording-discard")
        }
    }

    private func transferTranscript(
        confirmedReplacement: VisitRecordingLumeCoordinator.TranscriptReplacement? = nil
    ) {
        Task {
            let transferred = await coordinator.transferTranscript(
                maxCharacters: PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars,
                existingTranscript: model.newEntryVisitTranscript,
                confirmedReplacement: confirmedReplacement
            ) { transcript in
                onTransferTranscript(transcript)
            }
            transferNeedsReview = !transferred && coordinator.hasPendingReview
        }
    }

    private var permissionDeniedContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Accesso al microfono negato. La sessione è chiusa e non verrà ritentata automaticamente.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button("Apri Impostazioni Microfono") {
                guard let url = URL(
                    string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
                ) else { return }
                openURL(url)
            }
            .frame(minHeight: 44)
            .accessibilityIdentifier("clinical-workspace-visit-recording-open-settings")
        }
    }

    private func progressContent(_ message: String) -> some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(message).font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func unavailableContent(_ message: String) -> some View {
        Label(message, systemImage: "mic.slash")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }

    private func denialMessage(_ denial: VisitRecordingDenial) -> String {
        switch denial {
        case .permissionDenied: return "Accesso al microfono negato."
        case .interrupted: return "L’ascolto si è interrotto. La trascrizione non è completa ed è stata scartata."
        case .assetUnavailable: return "Asset di trascrizione non disponibile."
        case .staleBinding: return "Il paziente o la scheda sono cambiati. La trascrizione è stata scartata."
        case .bufferExceeded: return "L’ascolto si è interrotto per il limite di memoria. La trascrizione è stata scartata."
        case .sessionDurationExceeded: return "Durata massima dell’ascolto raggiunta."
        case .transcriptExceeded: return "Trascrizione oltre il limite consentito."
        case .invalidUsage, .failed: return "L’ascolto si è interrotto. La trascrizione è stata scartata."
        case .cancelled: return "Ascolto annullato."
        }
    }
}

private struct VisitRecordingWorkspaceContext: Equatable {
    let binding: VisitRecordingOwnerBinding
    let connection: ClinicalWorkspaceConnection.Identity
    let serverURL: String
    let tlsPin: String
}

private extension PairedPatientsWorkspaceModel {
    var visitRecordingWorkspaceContext: VisitRecordingWorkspaceContext? {
        guard let connection = clinicalWorkspaceConnection, connection.masterKey != nil,
              let patient = selectedPatient else { return nil }
        let ambulatoryID = ambulatoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !patient.id.isEmpty, patient.version > 0, !ambulatoryID.isEmpty else { return nil }
        return VisitRecordingWorkspaceContext(
            binding: VisitRecordingOwnerBinding(
                patientID: patient.id,
                patientVersion: patient.version,
                ambulatoryID: ambulatoryID
            ),
            connection: connection.identity,
            serverURL: serverURL,
            tlsPin: tlsPin
        )
    }
}
#endif
