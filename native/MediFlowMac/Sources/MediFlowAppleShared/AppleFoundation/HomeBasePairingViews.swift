import MediFlowCore
import SwiftUI

struct HomeBasePairingConfirmationView: View {
    @ObservedObject var router: ClinicalNavigationRouter
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let offer: HomeBasePairingLink
    let navigate: @MainActor (ClinicalNavigationArea) -> Void

    var body: some View {
        let previousClientID = model.pairingReplacementID
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(previousClientID == nil ? "Collega a MediFlow" : "Sostituisci collegamento")
                    .font(.headline)
                Text(offer.computer)
                Text(offer.origin.absoluteString)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Impronta SHA-256").font(.subheadline)
                    Text(displayedFingerprint).font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                }
                Text("Confronta l’impronta con quella mostrata in Impostazioni sul computer.")
                    .font(.subheadline)
                if let message = router.pairingMessage { Text(message).foregroundStyle(.secondary) }
                if router.pairingInProgress { ProgressView("Collegamento in corso") }
                ViewThatFits(in: .horizontal) {
                    HStack { actions(previousClientID) }
                    VStack(alignment: .leading) { actions(previousClientID) }
                }
            }
            .padding(24)
        }
        .interactiveDismissDisabled(router.pairingInProgress)
        #if os(macOS)
        .frame(width: 440, height: 305)
        #endif
    }

    private var displayedFingerprint: String {
        let bytes = Array(offer.fingerprint.utf8)
        return stride(from: 0, to: bytes.count, by: 4)
            .map { String(decoding: bytes[$0..<($0 + 4)], as: UTF8.self) }.joined(separator: " ")
    }

    @ViewBuilder
    private func actions(_ previousClientID: String?) -> some View {
        Button(router.pairingMessage == nil ? "Annulla" : "Chiudi", role: .cancel) { router.dismissPairing() }
            .disabled(router.pairingInProgress)
        Button(previousClientID == nil ? "Collega" : "Sostituisci") {
            Task { await router.confirmPairing(offer, model: model, replacing: previousClientID, navigate: navigate) }
        }
        .buttonStyle(.borderedProminent)
        .disabled(router.pairingInProgress || router.pairingMessage != nil || !model.canConfirmPairing)
        .accessibilityIdentifier("homebase-confirm-link")
    }
}

struct HomeBasePairingLoginView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let dismiss: () -> Void
    @FocusState private var focusesPassword: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Dispositivo collegato").font(.headline)
                SecureField("Passphrase o PIN precedente", text: $model.password)
                    .focused($focusesPassword)
                    .accessibilityIdentifier("homebase-pairing-password")
                    .onSubmit { signIn() }
                DisclosureGroup("Usa un nome utente") {
                    TextField("Nome utente", text: $model.username)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                }
                if let error = model.errorMessage { Text(error).foregroundStyle(.secondary) }
                HStack {
                    Button("Chiudi", role: .cancel) { model.password = ""; dismiss() }
                        .disabled(model.isWorking)
                    Button("Accedi", action: signIn)
                        .buttonStyle(.borderedProminent)
                        .disabled(model.password.isEmpty || model.isWorking)
                }
            }
            .padding(24)
        }
        .textFieldStyle(.roundedBorder)
        .interactiveDismissDisabled()
        .onAppear { focusesPassword = true }
        #if os(macOS)
        .frame(width: 440, height: 305)
        #endif
    }

    private func signIn() {
        guard !model.password.isEmpty, !model.isWorking else { return }
        Task {
            await model.login()
            if model.clinicalWorkspaceConnection != nil { dismiss() }
        }
    }
}
