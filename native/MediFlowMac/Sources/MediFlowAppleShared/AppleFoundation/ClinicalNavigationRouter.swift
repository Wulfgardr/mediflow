import MediFlowCore
import SwiftUI
import Combine

/* @Codex */
enum ClinicalNavigationAvailability: Equatable {
    case ready, locked, busy
}

enum ClinicalNavigationPatientResult: Equatable {
    case opened, blocked, notFound, failed, superseded
}

/// The workspace owns ordinary readers, draft guards and selection currentness.
/// A URL never supplies credentials or changes that authority.
@MainActor
protocol ClinicalNavigationWorkspace: AnyObject {
    var navigationAvailability: ClinicalNavigationAvailability { get }
    func openNavigationPatient(
        id: String, section: ClinicalNavigationPatientSection,
        isCurrent: @escaping @MainActor () -> Bool
    ) async -> ClinicalNavigationPatientResult
}

/// One successful presentation, consumed by the workspace after revealing the
/// selected chart. Consumption prevents a later remount from replaying the link.
struct ClinicalPatientNavigationPresentation: Equatable, Identifiable {
    let id: UUID
    let patientID: String
    let consume: @MainActor () -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.patientID == rhs.patientID
    }
}

private struct ClinicalPatientNavigationKey: EnvironmentKey {
    static let defaultValue: ClinicalPatientNavigationPresentation? = nil
}

/// Local sheets can contain unsaved fields that do not belong to the model yet.
/// Read their current state at commit time instead of changing modal ownership.
struct ClinicalNavigationInteractionScope {
    let register: @MainActor (UUID, @escaping @MainActor () -> Bool) -> Void
    let unregister: @MainActor (UUID) -> Void
}

private struct ClinicalNavigationInteractionKey: EnvironmentKey {
    static let defaultValue: ClinicalNavigationInteractionScope? = nil
}

extension EnvironmentValues {
    var clinicalPatientNavigation: ClinicalPatientNavigationPresentation? {
        get { self[ClinicalPatientNavigationKey.self] }
        set { self[ClinicalPatientNavigationKey.self] = newValue }
    }
    var clinicalNavigationInteraction: ClinicalNavigationInteractionScope? {
        get { self[ClinicalNavigationInteractionKey.self] }
        set { self[ClinicalNavigationInteractionKey.self] = newValue }
    }
}

@MainActor
final class ClinicalNavigationRouter: ObservableObject {
    @Published private(set) var notice: String?
    @Published private(set) var patientPresentation: ClinicalPatientNavigationPresentation?
    private var requestID: UUID?
    private var pendingTask: Task<Void, Never>?
    private var interactionGuards: [UUID: @MainActor () -> Bool] = [:]

    var interactionScope: ClinicalNavigationInteractionScope {
        ClinicalNavigationInteractionScope(
            register: { [weak self] id, isBlocked in self?.interactionGuards[id] = isBlocked },
            unregister: { [weak self] id in self?.interactionGuards.removeValue(forKey: id) }
        )
    }

    private var hasBlockedInteraction: Bool { interactionGuards.values.contains { $0() } }

    /// Called by ordinary manual navigation as well as a newer URL. No intent
    /// is queued for a future login, and a late completion cannot revive it.
    func cancel() {
        pendingTask?.cancel()
        pendingTask = nil
        requestID = nil
        patientPresentation = nil
    }

    func dismissNotice() { notice = nil }

    @discardableResult
    func open(
        _ url: URL, platform: ClinicalNavigationPlatform,
        workspace: (any ClinicalNavigationWorkspace)?,
        navigate: @escaping @MainActor (ClinicalNavigationArea) -> Void
    ) -> Task<Void, Never> {
        cancel()
        notice = nil
        // Reserve the intent synchronously at URL receipt, before scheduling
        // work: actor task scheduling must not reverse two incoming links.
        let id = UUID()
        requestID = id
        let task = Task {
            await resolve(url, platform: platform, workspace: workspace, navigate: navigate, requestID: id)
        }
        pendingTask = task
        return task
    }

    private func resolve(
        _ url: URL, platform: ClinicalNavigationPlatform,
        workspace: (any ClinicalNavigationWorkspace)?,
        navigate: @escaping @MainActor (ClinicalNavigationArea) -> Void,
        requestID id: UUID
    ) async {
        let isCurrent = { @MainActor [weak self] in
            self?.requestID == id && !Task.isCancelled && self?.hasBlockedInteraction == false
        }
        guard requestID == id, !Task.isCancelled else { return }
        defer {
            if requestID == id {
                requestID = nil
                pendingTask = nil
            }
        }
        guard let destination = ClinicalNavigationURL.parse(url) else {
            notice = "Collegamento non riconosciuto."
            return
        }
        let area: ClinicalNavigationArea
        switch destination {
        case .area(let target): area = target
        case .patient: area = .patients
        }
        guard area.isAvailable(on: platform) else {
            notice = "Questa area e disponibile solo sul Mac."
            return
        }
        guard let workspace else {
            notice = "Attendi che MediFlow sia pronto, poi riapri il collegamento."
            return
        }
        guard !hasBlockedInteraction else {
            notice = "Chiudi o completa il pannello aperto, poi riapri il collegamento."
            return
        }
        guard permit(workspace.navigationAvailability) else { return }

        switch destination {
        case .area:
            guard isCurrent() else { return }
            navigate(area)
        case .patient(let patientID, let section):
            let result = await workspace.openNavigationPatient(id: patientID, section: section, isCurrent: isCurrent)
            guard isCurrent() else { return }
            guard permit(workspace.navigationAvailability) else { return }
            switch result {
            case .opened:
                navigate(.patients)
                patientPresentation = ClinicalPatientNavigationPresentation(
                    id: id, patientID: patientID, consume: { [weak self] in
                        guard self?.patientPresentation?.id == id else { return }
                        self?.patientPresentation = nil
                    }
                )
            case .blocked:
                notice = "La cartella corrente resta aperta. Completa o annulla la modifica in corso, poi riapri il collegamento."
            case .notFound:
                notice = "Paziente non disponibile nello scope corrente."
            case .failed:
                notice = "Impossibile aprire la cartella. Verifica la connessione e riapri il collegamento."
            case .superseded:
                notice = "L'attività corrente e cambiata durante la lettura. Riapri il collegamento per continuare."
            }
        }
    }

    private func permit(_ availability: ClinicalNavigationAvailability) -> Bool {
        switch availability {
        case .ready:
            return true
        case .locked:
            notice = "Accedi e sblocca MediFlow, poi riapri il collegamento."
        case .busy:
            notice = "Completa o annulla la modifica, oppure attendi il termine dell'operazione in corso. Poi riapri il collegamento."
        }
        return false
    }
}

/// Install once per root, beneath the existing privacy shield. SwiftUI/OS URL
/// delivery is the only entry point; unknown URLs are never forwarded elsewhere.
struct ClinicalNavigationReception: ViewModifier {
    @ObservedObject var router: ClinicalNavigationRouter
    let platform: ClinicalNavigationPlatform
    let workspace: (any ClinicalNavigationWorkspace)?
    let navigate: @MainActor (ClinicalNavigationArea) -> Void
    private let sessionChanges: AnyPublisher<Void, Never>

    @MainActor
    init(
        router: ClinicalNavigationRouter, platform: ClinicalNavigationPlatform,
        workspace: PairedPatientsWorkspaceModel?,
        navigate: @escaping @MainActor (ClinicalNavigationArea) -> Void
    ) {
        self.router = router
        self.platform = platform
        self.workspace = workspace
        self.navigate = navigate
        // Observe the workspace directly: the Mac root observes its scene, not
        // every model publication. Even lock -> unlock before a read returns
        // must invalidate the old intent. Values are neither stored nor logged.
        if let workspace {
            sessionChanges = Publishers.MergeMany([
                workspace.$connectionState.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$serverURL.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$tlsPin.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$pairedClientId.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$pairedClientToken.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$ambulatoryId.removeDuplicates().dropFirst().map { _ in () }.eraseToAnyPublisher(),
                workspace.$operatorIdentity.map { $0?.userId }.removeDuplicates().dropFirst()
                    .map { _ in () }.eraseToAnyPublisher()
            ]).eraseToAnyPublisher()
        } else {
            sessionChanges = Empty().eraseToAnyPublisher()
        }
    }

    func body(content: Content) -> some View {
        content
            .environment(\.clinicalPatientNavigation, router.patientPresentation)
            .environment(\.clinicalNavigationInteraction, router.interactionScope)
            .onReceive(sessionChanges) { router.cancel() }
            .onOpenURL { url in
                router.open(url, platform: platform, workspace: workspace, navigate: navigate)
            }
            .alert("Collegamento MediFlow", isPresented: Binding(
                get: { router.notice != nil },
                set: { if !$0 { router.dismissNotice() } }
            )) {
                Button("OK", role: .cancel) { router.dismissNotice() }
            } message: {
                Text(router.notice ?? "")
            }
    }
}
