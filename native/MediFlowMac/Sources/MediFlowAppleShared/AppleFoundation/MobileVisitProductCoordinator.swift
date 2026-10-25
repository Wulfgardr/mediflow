import Combine
import CryptoKit
import Foundation
import MediFlowCore

@MainActor
final class MobileVisitProductCoordinator: ObservableObject {
    let vault: MobileVisitModel
    private weak var workspace: PairedPatientsWorkspaceModel?
    @Published private(set) var needsAuthentication = false
    @Published private(set) var isWorking = false
    @Published private(set) var message: String?
    private var requestID: UUID?
    private var recordID: UUID?

    init(workspace: PairedPatientsWorkspaceModel, store: MobileVisitStore, unlocker: any MobileVisitUnlocking) {
        self.workspace = workspace
        vault = MobileVisitModel(store: store, unlocker: unlocker)
    }

    func invalidateAuthority() { vault.lock() }

    func lock() {
        let cancelAuthentication = needsAuthentication || isWorking
        requestID = nil
        recordID = nil
        needsAuthentication = false
        isWorking = false
        message = nil
        vault.lock()
        workspace?.password = ""
        workspace?.clearMobileVisitComposer()
        if cancelAuthentication { workspace?.cancelMobileVisitAuthentication() }
    }

    func prepare() async {
        guard let workspace, let patientID = workspace.selectedPatient?.id else { return }
        do {
            let reader = try workspace.mobileVisitReader()
            await vault.prepare(patientID: patientID, online: reader, consent: true)
        } catch { show(error) }
    }

    func requestOnlineReview(_ id: UUID) {
        lock()
        requestID = UUID()
        recordID = id
        needsAuthentication = true
        message = "Accedi online, poi sblocca di nuovo l’appunto sul dispositivo. Nessun dato viene inviato."
    }

    func authenticateAndReview() async {
        guard !isWorking, let workspace, let ticket = requestID, let id = recordID else { return }
        isWorking = true
        defer { if requestID == ticket { isWorking = false } }
        do {
            try await workspace.authenticateMobileVisit()
            guard requestID == ticket, !Task.isCancelled else { return }
            needsAuthentication = false
            await vault.unlock()
            guard requestID == ticket, !Task.isCancelled else { return }
            let context = try vault.context(for: id)
            await vault.reviewOnline(id: id, freshLogin: { expected in
                guard expected == context else { throw MobileVisitError.invalidContext }
                return try workspace.mobileVisitReader()
            })
            guard requestID == ticket, vault.onlineReview != nil else { return }
            try await workspace.selectMobileVisitPatient(context)
            message = "Accesso corrente verificato. Rivedi le fonti e l’appunto prima di importarlo."
        } catch { if requestID == ticket { show(error) } }
    }

    func importNote(confirmed: Bool) async {
        guard let workspace else { return }
        await vault.importReviewedNote(confirmed: confirmed,
            freshLogin: { _ in try workspace.mobileVisitReader() },
            insertIntoOrdinaryComposer: { request in try workspace.importMobileVisit(request) })
    }

    func reconcile(_ id: UUID) async {
        guard !isWorking, let workspace else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let binding = try vault.unresolvedImport(recordID: id)
            let reader = try workspace.mobileVisitReader()
            guard reader.loginDigest != (try vault.preparationDigest(for: id)) else { throw MobileVisitError.denied }
            let current = try await reader.acquire(patientID: binding.context.patientID, forImport: true)
            guard current.context == binding.context else { throw MobileVisitError.invalidContext }
            try await workspace.reconcileMobileVisit(binding)
            message = vault.statusMessage ?? "Nessuna voce trovata per quell’ID. Puoi riprovare esplicitamente la stessa registrazione, conservando il contenuto originale."
        } catch { show(error) }
    }

    func registrationCanSubmit(_ binding: MobileVisitImport) -> Bool {
        guard let registration = try? vault.registration(for: binding) else { return false }
        return registration.phase == .draft
    }

    private func show(_ error: Error) { message = (error as? MobileVisitError ?? .denied).localizedDescription }
}
