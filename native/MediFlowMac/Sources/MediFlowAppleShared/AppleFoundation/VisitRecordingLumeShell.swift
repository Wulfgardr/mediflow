/* @Codex */
#if os(macOS)
import SwiftUI

@MainActor
struct VisitRecordingLumeShell: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @StateObject private var coordinator = VisitRecordingLumeCoordinator()
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    private var ownerBinding: VisitRecordingOwnerBinding? {
        model.visitRecordingOwnerBinding
    }

    var body: some View {
        Group {
            if #available(macOS 26.0, *) {
                supportedContent
            } else {
                unavailableContent(
                    "La registrazione locale richiede macOS 26 o successivo. Nessun permesso è stato richiesto."
                )
            }
        }
        .padding(12)
        .lumeSurface(zone: .field, cornerRadius: 12)
        .accessibilityIdentifier("clinical-workspace-visit-recording")
        .onChange(of: ownerBinding) { nextBinding in
            Task { await coordinator.ownerDidChange(to: nextBinding) }
        }
        .onChange(of: scenePhase) { _ in
            guard scenePhase != .active else { return }
            Task { await coordinator.cancelForLifecycle() }
        }
        .onDisappear {
            Task { await coordinator.cancelForLifecycle() }
        }
    }

    @ViewBuilder
    private var supportedContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Registrazione visita", systemImage: "waveform.badge.mic")
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
                progressContent("Avvio della registrazione locale…")
            case .recording:
                recordingContent
            case .finalizing:
                progressContent("Finalizzo la trascrizione sul Mac…")
            case .transcriptReview:
                transcriptReviewContent
            case .completed:
                Label("Trascrizione trasferita nel campo di revisione.", systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(LumePalette.success)
            case .permissionDenied:
                permissionDeniedContent
            case .unavailable:
                unavailableContent("Registrazione locale non disponibile. Chiudi e riapri la scheda per una nuova sessione.")
            case let .denied(denial):
                unavailableContent(denialMessage(denial))
            }
        }
    }

    private var disclosureContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("L'audio viene elaborato solo su questo Mac e non viene salvato. La trascrizione finale resta una bozza da rivedere; puoi interrompere in qualsiasi momento.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                let acceptedBinding = ownerBinding
                Task {
                    await coordinator.acceptDisclosure(for: acceptedBinding) {
                        model.visitRecordingOwnerBinding
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
                Label("Installa asset italiano", systemImage: "arrow.down.circle")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-install-assets")
        }
    }

    private var readyContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Microfono e trascrizione italiana sono pronti. L'avvio resta manuale.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                Task { await coordinator.start() }
            } label: {
                Label("Avvia registrazione", systemImage: "record.circle")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-start")
        }
    }

    private var recordingContent: some View {
        HStack(spacing: 12) {
            Label("Registrazione visita in corso", systemImage: "record.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(LumePalette.critical)
                .accessibilityLabel("Registrazione visita in corso")
            Spacer(minLength: 8)
            Button {
                Task { await coordinator.stop() }
            } label: {
                Label("Interrompi", systemImage: "stop.fill")
                    .frame(minHeight: 44)
            }
            .accessibilityIdentifier("clinical-workspace-visit-recording-stop")
        }
    }

    private var transcriptReviewContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rivedi la trascrizione finale. Nessuna bozza clinica viene generata automaticamente.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            TextEditor(text: $coordinator.reviewText)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 90)
                .clinicalMultilineFieldShape()
                .accessibilityIdentifier("clinical-workspace-visit-recording-review")
            HStack {
                Text("\(coordinator.reviewText.count)/\(PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars)")
                    .font(.caption2)
                    .foregroundStyle(
                        coordinator.reviewText.count <= PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
                            ? Color.secondary : LumePalette.critical
                    )
                Spacer(minLength: 8)
                Button {
                    Task {
                        await coordinator.transferTranscript(
                            maxCharacters: PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
                        ) { transcript in
                            model.newEntryVisitTranscript = transcript
                        }
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
        case .interrupted: return "Registrazione interrotta dal sistema. Avvia una nuova sessione."
        case .assetUnavailable: return "Asset di trascrizione non disponibile."
        case .staleBinding: return "Il contesto paziente è cambiato. La sessione è stata annullata."
        case .bufferExceeded: return "Registrazione interrotta per limite di memoria."
        case .sessionDurationExceeded: return "Durata massima della registrazione raggiunta."
        case .transcriptExceeded: return "Trascrizione oltre il limite consentito."
        case .invalidUsage, .failed: return "Registrazione locale terminata in sicurezza."
        case .cancelled: return "Registrazione annullata."
        }
    }
}

private extension PairedPatientsWorkspaceModel {
    var visitRecordingOwnerBinding: VisitRecordingOwnerBinding? {
        guard let patient = selectedPatient else { return nil }
        let ambulatoryID = ambulatoryId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !patient.id.isEmpty, patient.version > 0, !ambulatoryID.isEmpty else { return nil }
        return VisitRecordingOwnerBinding(
            patientID: patient.id,
            patientVersion: patient.version,
            ambulatoryID: ambulatoryID
        )
    }
}
#endif
