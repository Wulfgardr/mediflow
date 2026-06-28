import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor
final class PairedPatientsWorkspaceModel: ObservableObject {
    @Published var serverURL = HomeBasePairedSettings.defaultServerURL
    @Published var tlsPin = ""
    @Published var pairedClientId = ""
    @Published var pairedClientToken = ""
    @Published var username = ""
    @Published var password = ""
    @Published var ambulatoryId = ""
    @Published private(set) var patients: [HomeBasePatientSummary] = []
    @Published private(set) var selectedPatient: HomeBasePatientDetail?
    @Published private(set) var entries: [HomeBaseEntrySummary] = []
    @Published private(set) var therapies: [HomeBaseTherapySummary] = []
    @Published private(set) var checkups: [HomeBaseCheckupSummary] = []
    @Published private(set) var observations: [HomeBaseObservationSummary] = []
    @Published var newEntryTitle = ""
    @Published var newEntryType: PairedDiaryEntryType = .note
    @Published var newEntryContent = ""
    @Published private(set) var editingEntryId: String?
    @Published private(set) var editingEntryVersion: Int?
    @Published var editEntryTitle = ""
    @Published var editEntryType: PairedDiaryEntryType = .note
    @Published var editEntryContent = ""
    @Published var newTherapyDrugName = ""
    @Published var newTherapyActivePrinciple = ""
    @Published var newTherapyDosage = ""
    @Published var newTherapyMotivation = ""
    @Published var newTherapyStatus: PairedTherapyStatus = .active
    @Published var newTherapyStartDate = Date()
    @Published var newTherapyHasEndDate = false
    @Published var newTherapyEndDate = Date()
    @Published private(set) var editingTherapyId: String?
    @Published private(set) var editingTherapyVersion: Int?
    @Published var editTherapyDrugName = ""
    @Published var editTherapyActivePrinciple = ""
    @Published var editTherapyDosage = ""
    @Published var editTherapyMotivation = ""
    @Published var editTherapyStatus: PairedTherapyStatus = .active
    @Published var editTherapyStartDate = Date()
    @Published var editTherapyHasEndDate = false
    @Published var editTherapyEndDate = Date()
    @Published var newCheckupTitle = ""
    @Published var newCheckupNotes = ""
    @Published var newCheckupStatus: PairedCheckupStatus = .pending
    @Published var newCheckupDate = Date()
    @Published private(set) var editingCheckupId: String?
    @Published private(set) var editingCheckupVersion: Int?
    @Published var editCheckupTitle = ""
    @Published var editCheckupNotes = ""
    @Published var editCheckupStatus: PairedCheckupStatus = .pending
    @Published var editCheckupDate = Date()
    @Published var newObservationDisplay = ""
    @Published var newObservationCode = ""
    @Published var newObservationValue = ""
    @Published var newObservationUnitCode = ""
    @Published var newObservationNotes = ""
    @Published var newObservationObservedAt = Date()
    @Published private(set) var editingObservationId: String?
    @Published private(set) var editingObservationVersion: Int?
    @Published var editObservationDisplay = ""
    @Published var editObservationCode = ""
    @Published var editObservationValue = ""
    @Published var editObservationUnitCode = ""
    @Published var editObservationNotes = ""
    @Published var editObservationObservedAt = Date()
    @Published private(set) var discoveryMessage: String?
    @Published private(set) var statusMessage: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var connectionState: PairedPatientsConnectionState = .notLoaded
    @Published private(set) var reconciliationLine = "Sola lettura mobile. Nessuna scrittura offline disponibile."
    @Published private(set) var isWorking = false

    private let pairedStore: HomeBasePairedStore
    private let cacheStore: HomeBasePatientCacheStore
    private let automaticActions: AppleFoundationLaunchOverrides.AutomaticActions
    private var didPerformAutomaticActions = false
    private var sessionCookie: String?
    private var newEntryDraftId = UUID().uuidString

    init(
        pairedStore: HomeBasePairedStore = .shared,
        cacheStore: HomeBasePatientCacheStore = .shared
    ) {
        self.pairedStore = pairedStore
        self.cacheStore = cacheStore
        let launchOverrides = AppleFoundationLaunchOverrides.load()
        self.automaticActions = launchOverrides.automaticActions
        do {
            let snapshot = try pairedStore.loadSnapshot()
            self.serverURL = snapshot.settings.serverURL
            self.tlsPin = snapshot.settings.tlsPin
            self.pairedClientId = snapshot.settings.pairedClientId
            self.pairedClientToken = snapshot.pairedClientToken
            self.username = snapshot.settings.username
            self.ambulatoryId = snapshot.settings.ambulatoryId
        } catch {
            let settings = pairedStore.loadSettings()
            self.serverURL = settings.serverURL
            self.tlsPin = settings.tlsPin
            self.pairedClientId = settings.pairedClientId
            self.username = settings.username
            self.ambulatoryId = settings.ambulatoryId
            self.errorMessage = error.localizedDescription
        }
        applyLaunchOverrides(launchOverrides)
        restoreCachedPatientList()
    }

    func performAutomaticActionsIfNeeded() async {
        guard !didPerformAutomaticActions else { return }
        didPerformAutomaticActions = true

        if automaticActions.autoDiscover {
            await discoverHomeBase()
        }

        if automaticActions.autoLogin {
            guard errorMessage == nil else { return }
            await login()
        }

        if automaticActions.shouldAutoLoadPatients(hasActiveSession: sessionCookie != nil) {
            await loadPatients()
        }
    }

    func discoverHomeBase() async {
        await runTask {
            let candidate = try await HomeBaseBonjourDiscovery().discoverFirst()
            self.serverURL = candidate.serverURLString
            if let tlsPin = candidate.tlsPin {
                self.tlsPin = tlsPin
            }
            self.discoveryMessage = candidate.reviewLine
            self.statusMessage = "Home-base trovato in LAN."
        }
    }

    func login() async {
        guard !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Inserisci il PIN operatore."
            return
        }
        await runTask {
            self.sessionCookie = try await self.makeClient().login(
                username: self.username.trimmedOrNil,
                password: self.password
            )
            self.statusMessage = "Sessione operatore attiva."
        }
    }

    func loadPatients() async {
        guard let sessionCookie else {
            errorMessage = "Esegui prima la login operatore."
            return
        }
        guard let credentials = pairedCredentials else {
            errorMessage = "Inserisci le credenziali paired rilasciate dal Mac."
            return
        }
        await runTask {
            do {
                self.patients = try await self.makeClient().fetchPatients(
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                if self.restoreCachedPatientList(markOffline: true) {
                    self.errorMessage = error.localizedDescription
                    return
                }
                throw error
            }
            self.selectedPatient = nil
            self.entries = []
            self.therapies = []
            self.checkups = []
            self.observations = []
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
            do {
                try self.persistPairing()
                try self.cacheStore.savePatientList(
                    self.patients,
                    serverURL: self.serverURL,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                self.errorMessage = "Pazienti caricati, ma il salvataggio locale non e riuscito: \(error.localizedDescription)"
            }
            self.connectionState = .pairedOnline
            self.reconciliationLine = "Snapshot locale aggiornato. Sola lettura mobile."
            self.statusMessage = self.patients.isEmpty
                ? "Nessun paziente nello scope corrente."
                : "\(self.patients.count) pazienti caricati in lettura."
        }
    }

    func loadPatient(_ patient: HomeBasePatientSummary) async {
        guard let sessionCookie, let credentials = pairedCredentials else { return }
        await runTask {
            self.selectedPatient = try await self.makeClient().fetchPatient(
                id: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
            self.statusMessage = "Dettaglio \(patient.lastName) aperto in sola lettura."
        }
    }

    /* @Codex */
    func loadSelectedPatientEntries() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingEntry()
            self.statusMessage = "\(self.entries.count) voci diario caricate."
        }
    }

    /* @Codex */
    func createEntryForSelectedPatient() async {
        guard canCreateEntry else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = newEntryTitle.trimmedOrNil
        let type = newEntryType.rawValue
        let content = newEntryContent.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            _ = try await self.makeClient().createEntry(
                patientId: patientId,
                payload: HomeBaseEntryCreatePayload(
                    id: self.newEntryDraftId,
                    type: type,
                    title: title,
                    date: Date(),
                    content: content
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.newEntryTitle = ""
            self.newEntryType = .note
            self.newEntryContent = ""
            self.newEntryDraftId = UUID().uuidString
            self.statusMessage = "Voce diario inviata all'home-base."
            do {
                self.entries = try await self.makeClient().fetchEntries(
                    patientId: patientId,
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                self.errorMessage = "Voce inviata, ma aggiornamento diario non riuscito: \(error.localizedDescription)"
            }
        }
    }

    /* @Codex */
    func startEditingEntry(_ entry: HomeBaseEntrySummary) {
        guard canMutateEntry(entry) else { return }
        editingEntryId = entry.id
        editingEntryVersion = entry.version
        editEntryTitle = entry.title
        editEntryType = PairedDiaryEntryType(rawValue: entry.type) ?? .note
        editEntryContent = entry.content
        statusMessage = "Modifica voce diario pronta."
    }

    /* @Codex */
    func cancelEditingEntry() {
        editingEntryId = nil
        editingEntryVersion = nil
        editEntryTitle = ""
        editEntryType = .note
        editEntryContent = ""
    }

    /* @Codex */
    func updateEditingEntry() async {
        guard canUpdateEditingEntry else { return }
        guard let patientId = selectedPatient?.id,
              let entryId = editingEntryId,
              let version = editingEntryVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = editEntryTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = editEntryContent.trimmingCharacters(in: .whitespacesAndNewlines)
        let type = editEntryType.rawValue
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entryId,
                payload: HomeBaseEntryUpdatePayload(
                    version: version,
                    type: type,
                    title: title,
                    content: content
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingEntry()
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteEntry(id entryId: String) async {
        guard let entry = entries.first(where: { $0.id == entryId }),
              canMutateEntry(entry) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entry.id,
                payload: HomeBaseEntryUpdatePayload(
                    version: entry.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingEntryId == entry.id {
                self.cancelEditingEntry()
            }
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario annullata sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientTherapies() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingTherapy()
            self.statusMessage = "\(self.therapies.count) terapie caricate."
        }
    }

    /* @Codex */
    func createTherapyForSelectedPatient() async {
        guard canCreateTherapy else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let drugName = newTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let activePrinciple = newTherapyActivePrinciple.trimmedOrNil
        let dosage = newTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = newTherapyMotivation.trimmedOrNil
        let endDate = newTherapyHasEndDate ? newTherapyEndDate : nil
        await runTask {
            _ = try await self.makeClient().createTherapy(
                patientId: patientId,
                payload: HomeBaseTherapyCreatePayload(
                    drugName: drugName,
                    activePrinciple: activePrinciple,
                    dosage: dosage,
                    status: self.newTherapyStatus.rawValue,
                    startDate: self.newTherapyStartDate,
                    endDate: endDate,
                    motivation: motivation
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewTherapyForm()
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia inviata all'home-base."
        }
    }

    /* @Codex */
    func startEditingTherapy(_ therapy: HomeBaseTherapySummary) {
        guard canMutateTherapy(therapy) else { return }
        editingTherapyId = therapy.id
        editingTherapyVersion = therapy.version
        editTherapyDrugName = therapy.drugName
        editTherapyActivePrinciple = therapy.activePrinciple ?? ""
        editTherapyDosage = therapy.dosage
        editTherapyMotivation = therapy.motivation ?? ""
        editTherapyStatus = PairedTherapyStatus(rawValue: therapy.status) ?? .active
        editTherapyStartDate = therapy.startDate
        editTherapyHasEndDate = therapy.endDate != nil
        editTherapyEndDate = therapy.endDate ?? Date()
        statusMessage = "Modifica terapia pronta."
    }

    /* @Codex */
    func cancelEditingTherapy() {
        editingTherapyId = nil
        editingTherapyVersion = nil
        editTherapyDrugName = ""
        editTherapyActivePrinciple = ""
        editTherapyDosage = ""
        editTherapyMotivation = ""
        editTherapyStatus = .active
        editTherapyStartDate = Date()
        editTherapyHasEndDate = false
        editTherapyEndDate = Date()
    }

    /* @Codex */
    func updateEditingTherapy() async {
        guard canUpdateEditingTherapy else { return }
        guard let patientId = selectedPatient?.id,
              let therapyId = editingTherapyId,
              let version = editingTherapyVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let drugName = editTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let activePrinciple = editTherapyActivePrinciple.trimmingCharacters(in: .whitespacesAndNewlines)
        let dosage = editTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = editTherapyMotivation.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateTherapy(
                patientId: patientId,
                therapyId: therapyId,
                payload: HomeBaseTherapyUpdatePayload(
                    version: version,
                    drugName: drugName,
                    activePrinciple: activePrinciple,
                    dosage: dosage,
                    status: self.editTherapyStatus.rawValue,
                    startDate: self.editTherapyStartDate,
                    endDate: self.editTherapyHasEndDate ? self.editTherapyEndDate : nil,
                    shouldEncodeEndDate: true,
                    motivation: motivation
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingTherapy()
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteTherapy(id therapyId: String) async {
        guard let therapy = therapies.first(where: { $0.id == therapyId }),
              canMutateTherapy(therapy) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateTherapy(
                patientId: patientId,
                therapyId: therapy.id,
                payload: HomeBaseTherapyUpdatePayload(
                    version: therapy.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingTherapyId == therapy.id {
                self.cancelEditingTherapy()
            }
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia annullata sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientCheckups() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingCheckup()
            self.statusMessage = "\(self.checkups.count) controlli caricati."
        }
    }

    /* @Codex */
    func createCheckupForSelectedPatient() async {
        guard canCreateCheckup else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = newCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = newCheckupNotes.trimmedOrNil
        await runTask {
            _ = try await self.makeClient().createCheckup(
                patientId: patientId,
                payload: HomeBaseCheckupCreatePayload(
                    date: self.newCheckupDate,
                    title: title,
                    status: self.newCheckupStatus.rawValue,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewCheckupForm()
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo inviato all'home-base."
        }
    }

    /* @Codex */
    func startEditingCheckup(_ checkup: HomeBaseCheckupSummary) {
        guard canMutateCheckup(checkup) else { return }
        editingCheckupId = checkup.id
        editingCheckupVersion = checkup.version
        editCheckupTitle = checkup.title
        editCheckupNotes = checkup.notes ?? ""
        editCheckupStatus = PairedCheckupStatus(rawValue: checkup.status) ?? .pending
        editCheckupDate = checkup.date
        statusMessage = "Modifica controllo pronta."
    }

    /* @Codex */
    func cancelEditingCheckup() {
        editingCheckupId = nil
        editingCheckupVersion = nil
        editCheckupTitle = ""
        editCheckupNotes = ""
        editCheckupStatus = .pending
        editCheckupDate = Date()
    }

    /* @Codex */
    func updateEditingCheckup() async {
        guard canUpdateEditingCheckup else { return }
        guard let patientId = selectedPatient?.id,
              let checkupId = editingCheckupId,
              let version = editingCheckupVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = editCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = editCheckupNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateCheckup(
                patientId: patientId,
                checkupId: checkupId,
                payload: HomeBaseCheckupUpdatePayload(
                    version: version,
                    date: self.editCheckupDate,
                    title: title,
                    status: self.editCheckupStatus.rawValue,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingCheckup()
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo aggiornato sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteCheckup(id checkupId: String) async {
        guard let checkup = checkups.first(where: { $0.id == checkupId }),
              canMutateCheckup(checkup) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateCheckup(
                patientId: patientId,
                checkupId: checkup.id,
                payload: HomeBaseCheckupUpdatePayload(
                    version: checkup.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingCheckupId == checkup.id {
                self.cancelEditingCheckup()
            }
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo annullato sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientObservations() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingObservation()
            self.statusMessage = "\(self.observations.count) osservazioni caricate."
        }
    }

    /* @Codex */
    func createObservationForSelectedPatient() async {
        guard canCreateObservation else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let display = newObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = newObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = newObservationValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let unitCode = newObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = newObservationNotes.trimmedOrNil
        await runTask {
            _ = try await self.makeClient().createObservation(
                patientId: patientId,
                payload: HomeBaseObservationCreatePayload(
                    code: code,
                    display: display,
                    unitCode: unitCode,
                    value: value,
                    observedAt: self.newObservationObservedAt,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewObservationForm()
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione inviata all'home-base."
        }
    }

    /* @Codex */
    func startEditingObservation(_ observation: HomeBaseObservationSummary) {
        guard canMutateObservation(observation) else { return }
        editingObservationId = observation.id
        editingObservationVersion = observation.version
        editObservationDisplay = observation.display
        editObservationCode = observation.code
        editObservationValue = observation.value
        editObservationUnitCode = observation.unitCode
        editObservationNotes = observation.notes ?? ""
        editObservationObservedAt = observation.observedAt
        statusMessage = "Modifica osservazione pronta."
    }

    /* @Codex */
    func cancelEditingObservation() {
        editingObservationId = nil
        editingObservationVersion = nil
        editObservationDisplay = ""
        editObservationCode = ""
        editObservationValue = ""
        editObservationUnitCode = ""
        editObservationNotes = ""
        editObservationObservedAt = Date()
    }

    /* @Codex */
    func updateEditingObservation() async {
        guard canUpdateEditingObservation else { return }
        guard let patientId = selectedPatient?.id,
              let observationId = editingObservationId,
              let version = editingObservationVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let display = editObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = editObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = editObservationValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let unitCode = editObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = editObservationNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateObservation(
                patientId: patientId,
                observationId: observationId,
                payload: HomeBaseObservationUpdatePayload(
                    version: version,
                    code: code,
                    display: display,
                    unitCode: unitCode,
                    value: value,
                    observedAt: self.editObservationObservedAt,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingObservation()
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteObservation(id observationId: String) async {
        guard let observation = observations.first(where: { $0.id == observationId }),
              canMutateObservation(observation) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateObservation(
                patientId: patientId,
                observationId: observation.id,
                payload: HomeBaseObservationUpdatePayload(
                    version: observation.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingObservationId == observation.id {
                self.cancelEditingObservation()
            }
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione annullata sull'home-base."
        }
    }

    func savePairing() async {
        guard pairedCredentials != nil else {
            errorMessage = "Inserisci le credenziali paired rilasciate dal Mac."
            return
        }
        errorMessage = nil
        do {
            try persistPairing()
            statusMessage = "Credenziali paired salvate sul dispositivo."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearPairing() async {
        errorMessage = nil
        do {
            try pairedStore.clear()
            serverURL = HomeBasePairedSettings.defaultServerURL
            tlsPin = ""
            pairedClientId = ""
            pairedClientToken = ""
            username = ""
            password = ""
            ambulatoryId = ""
            patients = []
            selectedPatient = nil
            entries = []
            therapies = []
            checkups = []
            observations = []
            newEntryTitle = ""
            newEntryType = .note
            newEntryContent = ""
            newEntryDraftId = UUID().uuidString
            cancelEditingEntry()
            resetNewTherapyForm()
            cancelEditingTherapy()
            resetNewCheckupForm()
            cancelEditingCheckup()
            resetNewObservationForm()
            cancelEditingObservation()
            connectionState = .notLoaded
            reconciliationLine = "Sola lettura mobile. Nessuna scrittura offline disponibile."
            discoveryMessage = nil
            sessionCookie = nil
            try cacheStore.clear()
            statusMessage = "Configurazione paired rimossa da questo dispositivo."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var pairedCredentials: HomeBasePairedCredentials? {
        let clientId = pairedClientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let clientToken = pairedClientToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clientId.isEmpty, !clientToken.isEmpty else { return nil }
        return HomeBasePairedCredentials(clientId: clientId, clientToken: clientToken)
    }

    private func makeClient() -> HomeBasePatientsClient {
        HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: serverURL, tlsPin: tlsPin))
    }

    private func applyLaunchOverrides(_ launchOverrides: AppleFoundationLaunchOverrides) {
        if let serverURL = launchOverrides.serverURL {
            self.serverURL = serverURL
        }
        if let tlsPin = launchOverrides.tlsPin {
            self.tlsPin = tlsPin
        }
        if let pairedClientId = launchOverrides.pairedClientId {
            self.pairedClientId = pairedClientId
        }
        if let pairedClientToken = launchOverrides.pairedClientToken {
            self.pairedClientToken = pairedClientToken
        }
        if let username = launchOverrides.username {
            self.username = username
        }
        if let password = launchOverrides.password {
            self.password = password
        }
        if let ambulatoryId = launchOverrides.ambulatoryId {
            self.ambulatoryId = ambulatoryId
        }
    }

    private func persistPairing() throws {
        try pairedStore.save(
            settings: HomeBasePairedSettings(
                serverURL: serverURL,
                tlsPin: tlsPin,
                pairedClientId: pairedClientId,
                username: username,
                ambulatoryId: ambulatoryId
            ),
            pairedClientToken: pairedClientToken
        )
    }

    @discardableResult
    private func restoreCachedPatientList(markOffline: Bool = false) -> Bool {
        do {
            guard let snapshot = try cacheStore.loadPatientList(
                serverURL: serverURL,
                ambulatoryId: ambulatoryId.trimmedOrNil
            ) else {
                return false
            }
            patients = snapshot.patients
            selectedPatient = nil
            entries = []
            therapies = []
            checkups = []
            observations = []
            cancelEditingEntry()
            cancelEditingTherapy()
            cancelEditingCheckup()
            cancelEditingObservation()
            connectionState = markOffline ? .pairedOfflineDegraded : .cached
            statusMessage = markOffline ? "\(snapshot.reviewLine) Home-base non raggiungibile." : snapshot.reviewLine
            reconciliationLine = markOffline
                ? "Offline degradato: sola consultazione locale. Nessuna scrittura mobile disponibile."
                : "Snapshot locale pronto. Sola lettura mobile."
            return true
        } catch {
            errorMessage = "Cache locale non leggibile: \(error.localizedDescription)"
            return false
        }
    }

    private func runTask(_ operation: @escaping () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            if case HomeBaseClientError.httpStatus(let status, _) = error,
               status == 401 {
                connectionState = .sessionExpired
                sessionCookie = nil
                statusMessage = "Sessione operatore scaduta. Accedi di nuovo per scrivere sul Mac."
            } else if case HomeBaseClientError.httpStatus(let status, _) = error,
                      status == 403 {
                statusMessage = "Operazione non autorizzata nello scope paired corrente."
            } else if case HomeBaseClientError.httpStatus(let status, _) = error,
                      status == 409 {
                statusMessage = "Conflitto versione: ricarica il modulo e confronta la voce prima di salvare."
                errorMessage = nil
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    /* @Codex */
    private func resetNewTherapyForm() {
        newTherapyDrugName = ""
        newTherapyActivePrinciple = ""
        newTherapyDosage = ""
        newTherapyMotivation = ""
        newTherapyStatus = .active
        newTherapyStartDate = Date()
        newTherapyHasEndDate = false
        newTherapyEndDate = Date()
    }

    /* @Codex */
    private func resetNewCheckupForm() {
        newCheckupTitle = ""
        newCheckupNotes = ""
        newCheckupStatus = .pending
        newCheckupDate = Date()
    }

    /* @Codex */
    private func resetNewObservationForm() {
        newObservationDisplay = ""
        newObservationCode = ""
        newObservationValue = ""
        newObservationUnitCode = ""
        newObservationNotes = ""
        newObservationObservedAt = Date()
    }

    /* @Codex */
    var isEditingEntry: Bool {
        editingEntryId != nil
    }

    var canCreateEntry: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newEntryContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && newEntryContent.count <= 2000
            && !isWorking
    }

    /* @Codex */
    var isEditingTherapy: Bool {
        editingTherapyId != nil
    }

    /* @Codex */
    var canCreateTherapy: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingTherapy: Bool {
        editingTherapyId != nil
            && editingTherapyVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingEntry: Bool {
        editingEntryId != nil
            && editingEntryVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editEntryTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editEntryContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && editEntryContent.count <= 2000
            && !isWorking
    }

    /* @Codex */
    var isEditingCheckup: Bool {
        editingCheckupId != nil
    }

    /* @Codex */
    var canCreateCheckup: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingCheckup: Bool {
        editingCheckupId != nil
            && editingCheckupVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var isEditingObservation: Bool {
        editingObservationId != nil
    }

    /* @Codex */
    var canCreateObservation: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingObservation: Bool {
        editingObservationId != nil
            && editingObservationVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    func canMutateEntry(_ entry: HomeBaseEntrySummary) -> Bool {
        entry.deletedAt == nil
            && selectedPatient?.id == entry.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateTherapy(_ therapy: HomeBaseTherapySummary) -> Bool {
        therapy.deletedAt == nil
            && selectedPatient?.id == therapy.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateCheckup(_ checkup: HomeBaseCheckupSummary) -> Bool {
        checkup.deletedAt == nil
            && selectedPatient?.id == checkup.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateObservation(_ observation: HomeBaseObservationSummary) -> Bool {
        observation.deletedAt == nil
            && selectedPatient?.id == observation.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }
}

