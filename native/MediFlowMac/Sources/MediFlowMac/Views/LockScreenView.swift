// Codex: created 2026-02-01
import SwiftUI

struct LockScreenView: View {
    @EnvironmentObject private var security: SecuritySession
    @State private var pin = ""
    @State private var confirmPin = ""
    @State private var displayName = ""
    @State private var ambulatoryName = ""
    @State private var isWorking = false
    /* @Codex */
    @State private var isRepairing = false

    var body: some View {
        VStack(spacing: 24) {
            Text(security.requiresSetup ? "Crea PIN" : "Sblocca MediFlow")
                .font(.largeTitle.weight(.semibold))

            VStack(alignment: .leading, spacing: 12) {
                if security.requiresSetup {
                    TextField("Nome", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                    TextField("Ambulatorio", text: $ambulatoryName)
                        .textFieldStyle(.roundedBorder)
                }

                SecureField("PIN", text: $pin)
                    .textFieldStyle(.roundedBorder)

                if security.requiresSetup {
                    SecureField("Conferma PIN", text: $confirmPin)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .frame(maxWidth: 320)

            /* @Codex */
            if let health = security.healthIssue {
                VStack(alignment: .leading, spacing: 8) {
                    Text(health.title)
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text(health.message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let detail = health.detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                    Button("Riprova controllo") {
                        Task { await security.refreshSetupStatus() }
                    }
                    .buttonStyle(.bordered)
                    /* @Codex */
                    if health.canRepair {
                        Button(isRepairing ? "Ripristino in corso..." : "Ripristina DB da legacy") {
                            Task {
                                if isRepairing { return }
                                isRepairing = true
                                _ = await security.repairFromLegacy()
                                isRepairing = false
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isRepairing)
                    }
                }
                .frame(maxWidth: 360)
                .padding(.top, 8)
            }

            Button(isWorking ? "Attendere..." : actionTitle) {
                Task { await handleAction() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isWorking || pin.isEmpty || (security.requiresSetup && pin != confirmPin) || security.healthIssue != nil || isRepairing)

            if let error = security.errorMessage {
                Text(error)
                    .foregroundStyle(.red)
            }
        }
        .padding(40)
        .frame(minWidth: 520, minHeight: 380)
        .onAppear {
            Task { await security.refreshSetupStatus() }
        }
    }

    private var actionTitle: String {
        security.requiresSetup ? "Imposta PIN" : "Sblocca"
    }

    @MainActor
    private func handleAction() async {
        if isWorking { return }
        isWorking = true
        defer { isWorking = false }

        if security.requiresSetup {
            let name = displayName.isEmpty ? "Admin" : displayName
            let amb = ambulatoryName.isEmpty ? "Studio" : ambulatoryName
            _ = await security.setup(pin: pin, displayName: name, ambulatoryName: amb)
        } else {
            _ = await security.unlock(pin: pin)
        }
    }
}
