import SwiftUI
import CryptoKit
import MediFlowCore  // CryptoService now lives in the platform-free core (ADR 0071)
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor
final class PairedPatientsWorkspaceModel: ObservableObject {
    /// The operator field-crypto master key, derived from the PIN at login and
    /// held only in memory (never @Published, never persisted in clear). nil until
    /// a successful login delivers and unwraps it.
    private var masterKey: SymmetricKey?
    @Published var serverURL = HomeBasePairedSettings.defaultServerURL
    @Published var tlsPin = ""
    @Published var pairedClientId = ""
    @Published var pairedClientToken = ""
    @Published var username = ""
    @Published var password = ""
    @Published var ambulatoryId = ""
    @Published private(set) var availableAmbulatories: [NetworkAmbulatorySummary] = []
    @Published private(set) var patients: [HomeBasePatientSummary] = []
    @Published private(set) var selectedPatient: HomeBasePatientDetail?
    @Published private(set) var entries: [HomeBaseEntrySummary] = []
    @Published private(set) var therapies: [HomeBaseTherapySummary] = []
    @Published private(set) var checkups: [HomeBaseCheckupSummary] = []
    @Published private(set) var observations: [HomeBaseObservationSummary] = []
    @Published private(set) var patientReportURL: URL?
    @Published private(set) var servicePrescriptions: [HomeBaseServicePrescriptionSummary] = []
    @Published private(set) var servicePrescriptionItems: [HomeBaseServicePrescriptionItemSummary] = []
    @Published private(set) var prostheticPrescriptions: [HomeBaseProstheticPrescriptionSummary] = []
    @Published private(set) var patientFHIRExportURL: URL?
    @Published private(set) var pendingFHIRWarningValidation: HomeBaseValidatePatientExportResponse?
    @Published var newEntryTitle = ""
    @Published var newEntryType: PairedDiaryEntryType = .note
    @Published var newEntryContent = ""
    @Published private(set) var editingEntryId: String?
    @Published private(set) var editingEntryVersion: Int?
    @Published var editEntryTitle = ""
    @Published var editEntryType: PairedDiaryEntryType = .note
    @Published var editEntryContent = ""
    private var editingEntryOriginalContent: String?
    @Published var editPatientFirstName = ""
    @Published var editPatientLastName = ""
    @Published var editPatientTaxCode = ""
    @Published var editPatientAddress = ""
    @Published var editPatientPhone = ""
    @Published var editPatientCaregiver = ""
    @Published var editPatientNotes = ""
    @Published var editPatientIsArchived = false
    @Published private(set) var editPatientDiagnoses: [ClinicalDiagnosis] = []
    @Published var editPatientIsAdi = false
    @Published private(set) var editPatientExemptions: [String] = []
    @Published var newExemptionCode = ""
    /* @Codex */
    @Published private(set) var exemptionCatalogResults: [HomeBaseExemptionSummary] = []
    /* @Codex */
    @Published private(set) var isSearchingExemptionCatalog = false
    /* @Codex */
    @Published private(set) var exemptionCatalogStatusMessage: String?
    // Patient CREATE form (ADR 0071: served only by the on-device local authority).
    @Published var isCreatingPatient = false
    @Published var newPatientFirstName = ""
    @Published var newPatientLastName = ""
    @Published var newPatientTaxCode = ""
    @Published var newPatientHasBirthDate = false
    @Published var newPatientBirthDate = Date()
    @Published var newPatientAddress = ""
    @Published var newPatientPhone = ""
    @Published var newPatientCaregiver = ""
    @Published var newDiagnosisCode = ""
    @Published var newDiagnosisDescription = ""
    @Published private(set) var isEditingPatient = false
    @Published var newTherapyDrugName = ""
    @Published var newTherapyAIC = ""
    @Published var newTherapyATC = ""
    @Published var newTherapyActivePrinciple = ""
    @Published var newTherapyDosage = ""
    @Published var newTherapyMotivation = ""
    @Published var newTherapyStatus: PairedTherapyStatus = .active
    @Published var newTherapyStartDate = Date()
    @Published var newTherapyHasEndDate = false
    @Published var newTherapyEndDate = Date()
    @Published var newTherapyDiagnosisCode = ""
    /* @Codex */
    @Published private(set) var newTherapyDrugCatalogResults: [HomeBaseDrugSummary] = []
    /* @Codex */
    @Published private(set) var isSearchingNewTherapyDrugCatalog = false
    @Published private(set) var editingTherapyId: String?
    @Published private(set) var editingTherapyVersion: Int?
    @Published var editTherapyDrugName = ""
    @Published var editTherapyAIC = ""
    @Published var editTherapyATC = ""
    @Published var editTherapyActivePrinciple = ""
    @Published var editTherapyDosage = ""
    @Published var editTherapyMotivation = ""
    @Published var editTherapyStatus: PairedTherapyStatus = .active
    @Published var editTherapyStartDate = Date()
    @Published var editTherapyHasEndDate = false
    @Published var editTherapyEndDate = Date()
    @Published var editTherapyDiagnosisCode = ""
    /* @Codex */
    @Published private(set) var editTherapyDrugCatalogResults: [HomeBaseDrugSummary] = []
    /* @Codex */
    @Published private(set) var isSearchingEditTherapyDrugCatalog = false
    /* @Codex */
    @Published private(set) var drugCatalogStatusMessage: String?
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
    @Published private(set) var newObservationCodeTerminologyResults: [HomeBaseTerminologyItem] = []
    @Published private(set) var newObservationUnitTerminologyResults: [HomeBaseTerminologyItem] = []
    @Published private(set) var isSearchingNewObservationCodeTerminology = false
    @Published private(set) var isSearchingNewObservationUnitTerminology = false
    @Published private(set) var editingObservationId: String?
    @Published private(set) var editingObservationVersion: Int?
    @Published var editObservationDisplay = ""
    @Published var editObservationCode = ""
    @Published var editObservationValue = ""
    @Published var editObservationUnitCode = ""
    @Published var editObservationNotes = ""
    @Published var editObservationObservedAt = Date()
    @Published private(set) var editObservationCodeTerminologyResults: [HomeBaseTerminologyItem] = []
    @Published private(set) var editObservationUnitTerminologyResults: [HomeBaseTerminologyItem] = []
    @Published private(set) var isSearchingEditObservationCodeTerminology = false
    @Published private(set) var isSearchingEditObservationUnitTerminology = false
    @Published var newServicePrescribedAt = Date()
    @Published var newServiceStatus: PairedServicePrescriptionStatus = .prescribed
    @Published var newServiceCategory: PairedServicePrescriptionCategory = .specialistica
    @Published var newServicePriority: PairedServicePrescriptionPriority = .p
    @Published var newServiceCodeSystem = "NTR"
    @Published var newServiceCode = ""
    @Published var newServiceName = ""
    @Published var newServiceClinicalQuestion = ""
    @Published var newServiceProvider = ""
    @Published var newServiceHasScheduledAt = false
    @Published var newServiceScheduledAt = Date()
    @Published var newServiceHasPerformedAt = false
    @Published var newServicePerformedAt = Date()
    @Published var newServiceHasReportReceivedAt = false
    @Published var newServiceReportReceivedAt = Date()
    @Published var newServiceOutcomeNote = ""
    @Published var newServiceRequestReference = ""
    @Published var newServiceSource: PairedPrescriptionSource = .manual
    @Published var newServiceDocumentRefs = ""
    @Published var newServiceNotes = ""
    @Published var newServiceItemsText = ""
    @Published var newProstheticPrescribedAt = Date()
    @Published var newProstheticStatus: PairedProstheticPrescriptionStatus = .prescribed
    @Published var newProstheticCategory: PairedProstheticPrescriptionCategory = .ausilio
    @Published var newProstheticISOCode = ""
    @Published var newProstheticDescription = ""
    @Published var newProstheticMeasures = ""
    @Published var newProstheticClinicalReason = ""
    @Published var newProstheticRegionalPrescriptionId = ""
    @Published var newProstheticSupplier = ""
    @Published var newProstheticHasCollaudoAt = false
    @Published var newProstheticCollaudoAt = Date()
    @Published var newProstheticCollaudoOutcome = ""
    @Published var newProstheticSource: PairedPrescriptionSource = .manual
    @Published var newProstheticDocumentRefs = ""
    @Published var newProstheticNotes = ""
    @Published private(set) var discoveryMessage: String?
    @Published private(set) var statusMessage: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var connectionState: PairedPatientsConnectionState = .notLoaded
    @Published private(set) var reconciliationLine = "Scritture online dopo accesso operatore. Nessuna coda offline."

    /// The active typed 409 conflict, if a write was rejected because the record
    /// moved on the home-base. Drives the reconciliation banner; nil when clear.
    @Published private(set) var pendingConflict: VersionConflictPayload?

    /// Localized banner copy for `pendingConflict`, or nil when there is no conflict.
    var conflictPresentation: VersionConflictPresentation? {
        pendingConflict.map(VersionConflictPresentation.init)
    }
    @Published private(set) var isWorking = false

    private let pairedStore: HomeBasePairedStore
    private let cacheStore: HomeBasePatientCacheStore
    private let automaticActions: AppleFoundationLaunchOverrides.AutomaticActions
    private var didPerformAutomaticActions = false
    private var sessionCookie: String?
    private var newEntryDraftId = UUID().uuidString
    /* @Codex */
    private var newTherapyDrugCatalogTask: Task<Void, Never>?
    /* @Codex */
    private var editTherapyDrugCatalogTask: Task<Void, Never>?
    /* @Codex */
    private var exemptionCatalogTask: Task<Void, Never>?
    /* @Codex */
    private var newObservationCodeTerminologyTask: Task<Void, Never>?
    /* @Codex */
    private var newObservationUnitTerminologyTask: Task<Void, Never>?
    /* @Codex */
    private var editObservationCodeTerminologyTask: Task<Void, Never>?
    /* @Codex */
    private var editObservationUnitTerminologyTask: Task<Void, Never>?
    /* @Codex */
    private var isDrugCatalogAvailable = true
    /* @Codex */
    private var isExemptionCatalogAvailable = true
    /* @Codex */
    private var isTerminologySearchAvailable = true
    /* @Codex */
    private var lastSeenNetworkFingerprint: String?
    private let dataSourceFactory: (@MainActor (PairedPatientsWorkspaceModel) -> any HomeBasePatientsDataSource)?

    init(
        pairedStore: HomeBasePairedStore = .shared,
        cacheStore: HomeBasePatientCacheStore = .shared,
        dataSourceFactory: (@MainActor (PairedPatientsWorkspaceModel) -> any HomeBasePatientsDataSource)? = nil
    ) {
        self.pairedStore = pairedStore
        self.cacheStore = cacheStore
        self.dataSourceFactory = dataSourceFactory
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

    #if DEBUG
    /* @Codex */
    func configurePairedOnlineForTests(
        credentials: HomeBasePairedCredentials = HomeBasePairedCredentials(clientId: "test-client", clientToken: "test-token"),
        sessionCookie: String = "sid=test",
        masterKey: SymmetricKey? = nil,
        patients: [HomeBasePatientSummary] = [],
        selectedPatient: HomeBasePatientDetail? = nil
    ) {
        self.pairedClientId = credentials.clientId
        self.pairedClientToken = credentials.clientToken
        self.sessionCookie = sessionCookie
        self.masterKey = masterKey
        self.patients = patients
        self.selectedPatient = selectedPatient
        self.connectionState = .pairedOnline
    }
    #endif

    func performAutomaticActionsIfNeeded() async {
        guard !didPerformAutomaticActions else { return }
        didPerformAutomaticActions = true

        #if DEBUG
        if let seeded = Self.uiTestSeededPatients() {
            patients = seeded
            availableAmbulatories = Self.uiTestSeededAmbulatories()
            if ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_FORCE_CONFLICT"] == "1" {
                pendingConflict = Self.uiTestSeededConflict()
            }
            statusMessage = "Dati di test caricati."
            // Deep-link affordance: auto-open a seeded patient so the detail view
            // (scheda, diario, terapie, controlli, osservazioni) can be exercised
            // without tapping a row. Debug-only, never compiled into release.
            if let raw = ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_OPEN_PATIENT_INDEX"],
               let index = Int(raw), seeded.indices.contains(index) {
                await loadPatient(seeded[index])
            }
            return
        }
        #endif

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

    #if DEBUG
    /// UI-test fixture: with MEDIFLOW_APPLE_UITEST_PATIENTS=1, seed a deterministic
    /// patient list instead of hitting the network, so the search / filter UI can be
    /// exercised without a paired home-base. Debug-only, never compiled into release.
    static func uiTestSeededPatients() -> [HomeBasePatientSummary]? {
        guard ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_PATIENTS"] == "1" else {
            return nil
        }
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        return [
            HomeBasePatientSummary(id: "uitest-1", firstName: "Mario", lastName: "Rossi",
                                   birthDate: nil, taxCode: "RSSMRA80A01H501U",
                                   isAdi: false, isArchived: false, version: 1, updatedAt: base),
            HomeBasePatientSummary(id: "uitest-2", firstName: "Anna", lastName: "Bianchi",
                                   birthDate: nil, taxCode: "BNCNNA85M41F205X",
                                   isAdi: false, isArchived: false, version: 1,
                                   updatedAt: base.addingTimeInterval(-3600)),
            HomeBasePatientSummary(id: "uitest-3", firstName: "Luigi", lastName: "Verdi",
                                   birthDate: nil, taxCode: "VRDLGU70T10L219Z",
                                   isAdi: false, isArchived: true, version: 1,
                                   updatedAt: base.addingTimeInterval(-7200))
        ]
    }

    /// UI-test fixture detail for a seeded patient, so the patient-detail view can
    /// be exercised (exemptions, contacts, flags) without a paired home-base.
    static func uiTestSeededDetail(for patient: HomeBasePatientSummary) -> HomeBasePatientDetail? {
        guard ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_PATIENTS"] == "1" else {
            return nil
        }
        return HomeBasePatientDetail(
            id: patient.id, firstName: patient.firstName, lastName: patient.lastName,
            birthDate: Date(timeIntervalSince1970: 315_532_800),
            taxCode: patient.taxCode,
            address: "Via Roma 1, Milano", phone: "+39 02 1234567", caregiver: "Caregiver Test",
            exemptions: "[\"048\",\"C01\"]",
            diagnoses: "[{\"code\":\"E11.9\",\"description\":\"Diabete tipo 2\",\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]",
            monitoringProfile: "Profilo di monitoraggio test", statusReason: nil,
            notes: "Note cliniche di test.",
            aiSummary: "Quadro clinico stabile, terapia in corso ben tollerata.",
            documentInsights: "Referti recenti coerenti con il quadro noto, nessun nuovo reperto critico.",
            isAdi: patient.isAdi, isArchived: patient.isArchived, version: patient.version,
            ambulatoryId: "AMB-1", createdAt: nil, updatedAt: patient.updatedAt
        )
    }

    /// UI-test fixture therapies (one per status) so the therapy status filter can
    /// be exercised without a paired home-base.
    static func uiTestSeededTherapies(patientId: String) -> [HomeBaseTherapySummary] {
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        func make(_ id: String, drug: String, status: String) -> HomeBaseTherapySummary {
            HomeBaseTherapySummary(
                id: id, patientId: patientId, drugName: drug, aic: nil, atc: nil,
                activePrinciple: nil, dosage: "1 cp/die", motivation: nil,
                diagnosisCode: nil, diagnosisName: nil, status: status,
                startDate: base, endDate: nil, version: 1, createdAt: base, updatedAt: base,
                deletedAt: nil, deletionReason: nil
            )
        }
        return [
            make("therapy-active", drug: "Ramipril", status: "active"),
            make("therapy-suspended", drug: "Metformina", status: "suspended"),
            make("therapy-completed", drug: "Amoxicillina", status: "completed")
        ]
    }

    /// UI-test fixture checkups (one per status) so the checkup status filter can
    /// be exercised without a paired home-base.
    static func uiTestSeededCheckups(patientId: String) -> [HomeBaseCheckupSummary] {
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        func make(_ id: String, title: String, status: String) -> HomeBaseCheckupSummary {
            HomeBaseCheckupSummary(
                id: id, patientId: patientId, date: base, title: title, notes: nil,
                status: status, source: nil, version: 1, createdAt: base, updatedAt: base,
                deletedAt: nil, deletionReason: nil
            )
        }
        return [
            make("checkup-pending", title: "Visita cardiologica", status: "pending"),
            make("checkup-completed", title: "Esame del sangue", status: "completed"),
            make("checkup-cancelled", title: "Controllo annullato", status: "cancelled")
        ]
    }

    /// UI-test fixture diary entries (one per type) so the diary type filter can
    /// be exercised without a paired home-base.
    static func uiTestSeededEntries(patientId: String) -> [HomeBaseEntrySummary] {
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        func make(_ id: String, type: String, title: String) -> HomeBaseEntrySummary {
            HomeBaseEntrySummary(
                id: id, patientId: patientId, type: type, title: title, date: base,
                content: "Contenuto di test.", setting: nil, metadata: nil, attachments: nil,
                deletedAt: nil, deletionReason: nil, version: 1, createdAt: base, updatedAt: base
            )
        }
        return [
            make("entry-note", type: "note", title: "Nota clinica"),
            make("entry-visit", type: "visit", title: "Visita di controllo"),
            make("entry-phone", type: "phone", title: "Contatto telefonico")
        ]
    }

    static func uiTestSeededObservations(patientId: String) -> [HomeBaseObservationSummary] {
        let base = Date(timeIntervalSince1970: 1_750_000_000)
        func make(_ id: String, code: String, display: String, unit: String,
                  value: String, daysAgo: Double) -> HomeBaseObservationSummary {
            HomeBaseObservationSummary(
                id: id, patientId: patientId, codeSystem: "http://loinc.org", code: code,
                display: display, unitSystem: "http://unitsofmeasure.org", unitCode: unit,
                value: value, notes: nil, observedAt: base.addingTimeInterval(-daysAgo * 86400),
                source: "manual", version: 1, createdAt: nil, updatedAt: nil,
                deletedAt: nil, deletionReason: nil
            )
        }
        return [
            // Two weight readings of the same code: the newer one trends "rising".
            make("obs-weight-new", code: "29463-7", display: "Peso corporeo", unit: "kg", value: "82", daysAgo: 0),
            make("obs-weight-old", code: "29463-7", display: "Peso corporeo", unit: "kg", value: "80", daysAgo: 1),
            // Two heart-rate readings: the newer one trends "falling".
            make("obs-hr-new", code: "8867-4", display: "Frequenza cardiaca", unit: "/min", value: "72", daysAgo: 0),
            make("obs-hr-old", code: "8867-4", display: "Frequenza cardiaca", unit: "/min", value: "80", daysAgo: 1),
            // A single reading of another code: no predecessor, so no trend arrow.
            make("obs-glucose", code: "2339-0", display: "Glicemia", unit: "mg/dL", value: "95", daysAgo: 0)
        ]
    }

    static func uiTestSeededAmbulatories() -> [NetworkAmbulatorySummary] {
        [
            NetworkAmbulatorySummary(id: "AMB-1", name: "Ambulatorio Centrale", address: "Via Roma 1",
                                     type: "principale", isDefault: true, createdAt: nil),
            NetworkAmbulatorySummary(id: "AMB-2", name: "Ambulatorio Nord", address: "Via Verdi 9",
                                     type: "distaccato", isDefault: false, createdAt: nil)
        ]
    }

    static func uiTestSeededConflict() -> VersionConflictPayload {
        VersionConflictPayload(
            error: "Version conflict",
            code: "VERSION_CONFLICT",
            entity: "patient",
            recordId: "uitest-1",
            expectedVersion: 1,
            currentVersion: 2,
            currentUpdatedAt: "2026-06-29T10:15:00.000Z",
            currentState: "active",
            currentSnapshot: VersionConflictSnapshot(
                id: "uitest-1", patientId: nil, version: 2,
                updatedAt: "2026-06-29T10:15:00.000Z", deletedAt: nil, isArchived: false
            )
        )
    }
    #endif

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
            let result = try await self.makeClient().login(
                username: self.username.trimmedOrNil,
                password: self.password
            )
            self.sessionCookie = result.sessionCookie
            self.unlockFieldCrypto(with: result, pin: self.password)
            self.resetCatalogAvailability()
            self.statusMessage = self.masterKey == nil
                ? "Sessione operatore attiva. Cifratura campi non disponibile."
                : "Sessione operatore attiva."
        }
    }

    func changePin(currentPin: String, newPin: String) async {
        guard let masterKey else {
            errorMessage = "Cifratura non disponibile: riaccedi con il PIN operatore prima di cambiarlo."
            return
        }
        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Sessione operatore non attiva. Accedi di nuovo prima di cambiare il PIN."
            return
        }
        guard !currentPin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Inserisci il PIN attuale."
            return
        }
        guard (4...8).contains(newPin.count) else {
            errorMessage = "Il nuovo PIN deve avere tra 4 e 8 caratteri."
            return
        }
        guard newPin != currentPin else {
            errorMessage = "Il nuovo PIN deve essere diverso dal PIN attuale."
            return
        }

        let salt = Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
        guard let wrappedMasterKey = CryptoService.wrapMasterKeyVersioned(
            masterKey,
            pin: newPin,
            salt: salt,
            version: CryptoService.currentKdfVersion
        ) else {
            errorMessage = "Cifratura della chiave non riuscita: il PIN non e stato modificato."
            return
        }

        await runTask {
            let acknowledgement = try await self.makeClient().changePin(
                currentPin: currentPin,
                newPin: newPin,
                encryptedMasterKey: wrappedMasterKey,
                salt: salt.base64EncodedString(),
                credentials: credentials,
                sessionCookie: sessionCookie
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            // Deliberately keep the exact same masterKey instance in RAM. A PIN
            // rotation changes only the KEK + salt + wrapped blob on the home-base.
            self.statusMessage = "PIN aggiornato. La chiave clinica in memoria resta invariata."
        }
    }

    func lockSessionNow() async {
        isWorking = true
        errorMessage = nil
        pendingConflict = nil
        defer { isWorking = false }

        var remoteLogoutConfirmed = false
        if let sessionCookie, let credentials = pairedCredentials {
            do {
                let acknowledgement = try await makeClient().logout(
                    credentials: credentials,
                    sessionCookie: sessionCookie
                )
                remoteLogoutConfirmed = acknowledgement.success
            } catch {
                // D10: remote logout is best-effort. Local key/session destruction
                // below is unconditional and must never be skipped by transport errors.
            }
        }

        sessionCookie = nil
        masterKey = nil
        connectionState = .sessionExpired
        statusMessage = remoteLogoutConfirmed
            ? "Sessione bloccata. Accedi di nuovo per continuare."
            : "Sessione bloccata localmente. Logout remoto non confermato; accedi di nuovo per continuare."
    }

    /// Derive the field-crypto master key from the operator PIN + the wrapped key
    /// material returned by login (same as the web client). Kept only in memory.
    private func unlockFieldCrypto(with result: HomeBaseLoginResult, pin: String) {
        guard let wrapped = result.encryptedMasterKey,
              let saltB64 = result.salt,
              let salt = Data(base64Encoded: saltB64) else {
            masterKey = nil
            return
        }
        masterKey = CryptoService.unwrapMasterKeyVersioned(blob: wrapped, pin: pin, salt: salt)
    }

    func loadPatients(includeDeleted: Bool = false) async {
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
                    ambulatoryId: self.ambulatoryId.trimmedOrNil,
                    includeDeleted: includeDeleted
                )
                .map { PatientFieldCrypto.decryptSummary($0, masterKey: self.masterKey) }
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
            self.patientReportURL = nil
            self.servicePrescriptions = []
            self.servicePrescriptionItems = []
            self.prostheticPrescriptions = []
            self.patientFHIRExportURL = nil
            self.pendingFHIRWarningValidation = nil
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
            // Best-effort: populate the scope picker. A failure here must not
            // break the patient load, so keep whatever list we already have.
            self.availableAmbulatories = (try? await self.makeClient().fetchNetworkAmbulatories(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )) ?? self.availableAmbulatories
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
            self.reconciliationLine = "Snapshot locale aggiornato. Scritture online con sessione operatore."
            let visibleCount = includeDeleted ? self.patients.filter { $0.deletedAt != nil }.count : self.patients.count
            self.statusMessage = visibleCount == 0
                ? (includeDeleted ? "Nessun paziente nel cestino." : "Nessun paziente nello scope corrente.")
                : "\(visibleCount) pazienti caricati in lettura."
        }
    }

    /* @Codex */
    func loadPatientTrash() async {
        await loadPatients(includeDeleted: true)
        selectedPatient = nil
        entries = []
        therapies = []
        checkups = []
        observations = []
        patientReportURL = nil
        servicePrescriptions = []
        servicePrescriptionItems = []
        prostheticPrescriptions = []
        patientFHIRExportURL = nil
        pendingFHIRWarningValidation = nil
    }

    func loadPatient(_ patient: HomeBasePatientSummary) async {
        #if DEBUG
        if let detail = Self.uiTestSeededDetail(for: patient) {
            selectedPatient = detail
            entries = Self.uiTestSeededEntries(patientId: patient.id)
            therapies = Self.uiTestSeededTherapies(patientId: patient.id)
            checkups = Self.uiTestSeededCheckups(patientId: patient.id)
            observations = Self.uiTestSeededObservations(patientId: patient.id)
            patientReportURL = nil
            patientFHIRExportURL = nil
            return
        }
        #endif
        guard let sessionCookie, let credentials = pairedCredentials else { return }
        await runTask {
            self.patientReportURL = nil
            self.patientFHIRExportURL = nil
            self.pendingFHIRWarningValidation = nil
            let fetchedDetail = try await self.makeClient().fetchPatient(
                id: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.selectedPatient = PatientFieldCrypto.decryptDetail(fetchedDetail, masterKey: self.masterKey)
            self.entries = try await self.fetchDecryptedEntries(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.therapies = try await self.fetchDecryptedTherapies(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.checkups = try await self.fetchDecryptedCheckups(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.observations = try await self.fetchDecryptedObservations(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.servicePrescriptions = try await self.fetchServicePrescriptions(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.servicePrescriptionItems = try await self.fetchServicePrescriptionItems(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.prostheticPrescriptions = try await self.fetchProstheticPrescriptions(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
            self.statusMessage = "Dettaglio \(patient.lastName) aperto."
        }
    }

    /// Refetch the selected patient and all sub-resources after a version conflict,
    /// so the operator sees the current home-base state before reapplying. The safe,
    /// no-clobber resolution: it reloads, it does not auto-overwrite the other edit.
    func reloadAfterConflict() async {
        #if DEBUG
        if Self.isUITestSeeded {
            pendingConflict = nil
            statusMessage = "Dati ricaricati."
            return
        }
        #endif
        guard let current = selectedPatient, let sessionCookie, let credentials = pairedCredentials else {
            pendingConflict = nil
            return
        }
        let id = current.id
        await runTask {
            let fetchedDetail = try await self.makeClient().fetchPatient(
                id: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.selectedPatient = PatientFieldCrypto.decryptDetail(fetchedDetail, masterKey: self.masterKey)
            self.patientReportURL = nil
            self.patientFHIRExportURL = nil
            self.pendingFHIRWarningValidation = nil
            self.entries = try await self.fetchDecryptedEntries(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.therapies = try await self.fetchDecryptedTherapies(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.checkups = try await self.fetchDecryptedCheckups(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.observations = try await self.fetchDecryptedObservations(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.servicePrescriptions = try await self.fetchServicePrescriptions(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.servicePrescriptionItems = try await self.fetchServicePrescriptionItems(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.prostheticPrescriptions = try await self.fetchProstheticPrescriptions(
                patientId: id, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "Dati aggiornati dall'home-base. Riapplica la modifica."
        }
    }

    /// Clear the conflict banner without reloading (operator chose to ignore it).
    func dismissConflict() {
        pendingConflict = nil
    }

    /// A18: switch the active ambulatory scope. Updates the id used by every read
    /// and reloads the patient list so the new scope takes effect.
    func selectAmbulatory(_ id: String) {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != ambulatoryId else { return }
        ambulatoryId = trimmed
        #if DEBUG
        if Self.isUITestSeeded {
            statusMessage = "Scope attivo: \(trimmed)."
            return
        }
        #endif
        Task { await loadPatients() }
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
            self.entries = try await self.fetchDecryptedEntries(
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
                    title: try self.sealField(title),
                    date: Date(),
                    content: try self.sealField(content) ?? ""
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
                self.entries = try await self.fetchDecryptedEntries(
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

    /// A10: submit a completed clinical scale as a `type:"scale"` diary entry whose
    /// encrypted metadata matches the web's shape, so the web reads it back.
    func submitScale(_ definition: ClinicalScaleDefinition, answers: [String: Int]) async {
        guard let patientId = selectedPatient?.id else { return }
        let result = definition.result(from: answers)
        let metadataJSON = ClinicalScales.metadataJSON(definition: definition, result: result)
        let content = ClinicalScales.contentSummary(definition: definition, result: result)

        #if DEBUG
        if Self.isUITestSeeded {
            let base = Date(timeIntervalSince1970: 1_750_000_000)
            entries.insert(HomeBaseEntrySummary(
                id: "scale-\(definition.id)-\(result.score)", patientId: patientId, type: "scale",
                title: definition.title, date: base, content: content, setting: nil,
                metadata: metadataJSON, attachments: nil, deletedAt: nil, deletionReason: nil,
                version: 1, createdAt: base, updatedAt: base
            ), at: 0)
            statusMessage = "Valutazione \(definition.title) inviata: \(result.score)/\(definition.maxScore)."
            return
        }
        #endif

        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            _ = try await self.makeClient().createEntry(
                patientId: patientId,
                payload: HomeBaseEntryCreatePayload(
                    id: UUID().uuidString,
                    type: "scale",
                    title: try self.sealField(definition.title),
                    date: Date(),
                    content: try self.sealField(content) ?? "",
                    metadata: try self.sealStructuredField(metadataJSON)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Valutazione \(definition.title) inviata: \(result.score)/\(definition.maxScore)."
            self.entries = try await self.fetchDecryptedEntries(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
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
        editingEntryOriginalContent = entry.content
        statusMessage = "Modifica voce diario pronta."
    }

    /* @Codex */
    func cancelEditingEntry() {
        editingEntryId = nil
        editingEntryVersion = nil
        editEntryTitle = ""
        editEntryType = .note
        editEntryContent = ""
        editingEntryOriginalContent = nil
    }

    /* @Codex */
    func insertNewEntrySOAPTemplate() {
        newEntryContent = ClinicalSOAPTemplate.html
        statusMessage = "Template S/O/A/P inserito."
    }

    // ADR 0071 update: patient CREATE still works through the on-device local
    // authority when available, and now also has a paired HTTP wire path gated by
    // network.replica.write-patient-lifecycle.
    var canCreatePatient: Bool {
        !isWorking
        && !newPatientFirstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !newPatientLastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !newPatientTaxCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func startCreatingPatient() {
        newPatientFirstName = ""
        newPatientLastName = ""
        newPatientTaxCode = ""
        newPatientHasBirthDate = false
        newPatientBirthDate = Date()
        newPatientAddress = ""
        newPatientPhone = ""
        newPatientCaregiver = ""
        isCreatingPatient = true
        statusMessage = "Nuovo paziente pronto."
    }

    func cancelCreatingPatient() {
        isCreatingPatient = false
    }

    func createPatient() async {
        guard canCreatePatient else { return }
        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima una sessione paired online."
            return
        }
        // Refuse to create without the key: the sensitive fields are sealed here
        // before the payload leaves the model, so both the wire boundary (which
        // rejects plaintext with 400) and the local store (sealOrPassthrough,
        // never double-encrypts) receive ENC: values.
        guard masterKey != nil else {
            errorMessage = "Cifratura non disponibile: riaccedi con il PIN operatore prima di creare."
            return
        }
        await runTask {
            let payload = HomeBasePatientCreatePayload(
                firstName: self.newPatientFirstName.trimmingCharacters(in: .whitespacesAndNewlines),
                lastName: self.newPatientLastName.trimmingCharacters(in: .whitespacesAndNewlines),
                taxCode: self.newPatientTaxCode.trimmingCharacters(in: .whitespacesAndNewlines),
                birthDate: self.newPatientHasBirthDate ? self.newPatientBirthDate : nil,
                address: try self.sealField(self.newPatientAddress.trimmedOrNil),
                phone: try self.sealField(self.newPatientPhone.trimmedOrNil),
                caregiver: try self.sealField(self.newPatientCaregiver.trimmedOrNil)
            )
            let created = try await self.makeClient().createPatient(
                payload: payload, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.isCreatingPatient = false
            self.patients = try await self.makeClient().fetchPatients(
                credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "Paziente creato sull'home-base (id \(created.id))."
        }
    }

    // A4: edit patient anagrafica.
    func startEditingPatient() {
        guard let patient = selectedPatient else { return }
        editPatientFirstName = patient.firstName
        editPatientLastName = patient.lastName
        editPatientTaxCode = patient.taxCode
        editPatientAddress = patient.address ?? ""
        editPatientPhone = patient.phone ?? ""
        editPatientCaregiver = patient.caregiver ?? ""
        editPatientNotes = patient.notes ?? ""
        editPatientIsArchived = patient.isArchived ?? false
        editPatientIsAdi = patient.isAdi ?? false
        editPatientDiagnoses = DiagnosesCodec.decode(patient.diagnoses)
        editPatientExemptions = ExemptionCodesCodec.decode(patient.exemptions)
        newExemptionCode = ""
        resetExemptionCatalogSearch(clearAvailability: false)
        newDiagnosisCode = ""
        newDiagnosisDescription = ""
        isEditingPatient = true
        statusMessage = "Modifica anagrafica pronta."
    }

    func addDiagnosis() {
        addDiagnosis(code: newDiagnosisCode, description: newDiagnosisDescription, system: nil)
        newDiagnosisCode = ""
        newDiagnosisDescription = ""
    }

    func addExemption() {
        let code = ExemptionCodesCodec.normalizedCode(newExemptionCode)
        guard !code.isEmpty, !editPatientExemptions.contains(code) else { return }
        editPatientExemptions.append(code)
        newExemptionCode = ""
        resetExemptionCatalogSearch(clearAvailability: false)
    }

    /* @Codex */
    func scheduleExemptionCatalogSearch() {
        exemptionCatalogTask?.cancel()
        guard isExemptionCatalogAvailable else {
            exemptionCatalogResults = []
            isSearchingExemptionCatalog = false
            return
        }
        let query = newExemptionCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= Self.catalogMinimumQueryLength else {
            exemptionCatalogResults = []
            isSearchingExemptionCatalog = false
            return
        }
        exemptionCatalogTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.catalogSearchDebounceNanoseconds)
            guard !Task.isCancelled else { return }
            await self?.performExemptionCatalogSearch(query: query)
        }
    }

    /* @Codex */
    func selectExemptionCatalogResult(_ exemption: HomeBaseExemptionSummary) {
        editPatientExemptions = CatalogSelection.adding(exemption, to: editPatientExemptions)
        newExemptionCode = ""
        resetExemptionCatalogSearch(clearAvailability: false)
    }

    func removeExemption(_ code: String) {
        editPatientExemptions.removeAll { $0 == code }
    }

    /// A14: add a (possibly ICD-coded) diagnosis. system carries the coding system
    /// for ICD-picked entries (e.g. "ICD-10"), nil for free-text. date == nil so
    /// encode stamps it with "now" while existing diagnoses keep their date.
    func addDiagnosis(code: String, description: String, system: String?) {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty || !description.isEmpty else { return }
        editPatientDiagnoses.append(ClinicalDiagnosis(code: code, description: description, system: system, date: nil))
    }

    func removeDiagnosis(at offsets: IndexSet) {
        editPatientDiagnoses.remove(atOffsets: offsets)
    }

    func cancelEditingPatient() {
        isEditingPatient = false
        resetExemptionCatalogSearch(clearAvailability: false)
    }

    func savePatient() async {
        guard let current = selectedPatient else { return }

        #if DEBUG
        if Self.isUITestSeeded {
            selectedPatient = editedPatientDetail(from: current)
            isEditingPatient = false
            statusMessage = "Anagrafica aggiornata."
            return
        }
        #endif

        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        // Encrypted clinical fields are sealed on-device before they leave: the
        // home-base only ever stores ciphertext (zero-knowledge), like the web.
        // Without the key we refuse the write rather than persist plaintext.
        guard let masterKey else {
            errorMessage = "Cifratura non disponibile: riaccedi con il PIN operatore prima di salvare."
            return
        }
        let payload = HomeBasePatientUpdatePayload(
            version: current.version,
            firstName: editPatientFirstName.trimmingCharacters(in: .whitespacesAndNewlines),
            lastName: editPatientLastName.trimmingCharacters(in: .whitespacesAndNewlines),
            taxCode: editPatientTaxCode.trimmingCharacters(in: .whitespacesAndNewlines),
            isAdi: editPatientIsAdi,
            isArchived: editPatientIsArchived,
            address: encryptedStringPatchValue(editPatientAddress, masterKey: masterKey),
            phone: encryptedStringPatchValue(editPatientPhone, masterKey: masterKey),
            caregiver: encryptedStringPatchValue(editPatientCaregiver, masterKey: masterKey),
            notes: encryptedStringPatchValue(editPatientNotes, masterKey: masterKey),
            diagnoses: encryptedDiagnosesPatchValue(masterKey: masterKey),
            exemptions: encryptedExemptionsPatchValue(masterKey: masterKey)
        )
        let patientId = current.id
        await runTask {
            let acknowledgement = try await self.makeClient().updatePatient(
                patientId: patientId,
                payload: payload,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.isEditingPatient = false
            let fetchedDetail = try await self.makeClient().fetchPatient(
                id: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.selectedPatient = PatientFieldCrypto.decryptDetail(fetchedDetail, masterKey: self.masterKey)
            self.statusMessage = "Anagrafica aggiornata sull'home-base."
        }
    }

    /* @Codex */
    var isFieldCryptoUnlocked: Bool {
        masterKey != nil
    }

    /* @Codex */
    var canArchivePatient: Bool {
        guard let patient = selectedPatient else { return false }
        return patient.deletedAt == nil
            && patient.isArchived != true
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    var canUnarchivePatient: Bool {
        guard let patient = selectedPatient else { return false }
        return patient.deletedAt == nil
            && patient.isArchived == true
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    var canSoftDeletePatient: Bool {
        guard let patient = selectedPatient else { return false }
        return patient.deletedAt == nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canRestorePatient(_ patient: HomeBasePatientSummary) -> Bool {
        patient.deletedAt != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func setSelectedPatientArchived(_ isArchived: Bool) async {
        guard let current = selectedPatient else { return }
        guard (isArchived && canArchivePatient) || (!isArchived && canUnarchivePatient) else { return }
        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let payload = HomeBasePatientUpdatePayload(version: current.version, isArchived: isArchived)
        await runTask {
            let acknowledgement = try await self.makeClient().updatePatient(
                patientId: current.id,
                payload: payload,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            let fetchedDetail = try await self.makeClient().fetchPatient(
                id: current.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.selectedPatient = PatientFieldCrypto.decryptDetail(fetchedDetail, masterKey: self.masterKey)
            self.patients = try await self.makeClient().fetchPatients(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            .map { PatientFieldCrypto.decryptSummary($0, masterKey: self.masterKey) }
            self.statusMessage = isArchived
                ? "Paziente archiviato sull'home-base."
                : "Paziente riattivato sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteSelectedPatient(reason: String?) async {
        guard let patient = selectedPatient, canSoftDeletePatient else { return }
        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let trimmedReason = reason?.trimmingCharacters(in: .whitespacesAndNewlines).trimmedOrNil
        if trimmedReason != nil && masterKey == nil {
            errorMessage = "Cifratura non disponibile: riaccedi con il PIN operatore oppure lascia vuota la motivazione."
            return
        }
        await runTask {
            let sealedReason = trimmedReason == nil ? nil : try self.sealField(trimmedReason)
            let acknowledgement = try await self.makeClient().softDeletePatient(
                id: patient.id,
                version: patient.version,
                sealedReason: sealedReason,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.selectedPatient = nil
            self.entries = []
            self.therapies = []
            self.checkups = []
            self.observations = []
            self.patientReportURL = nil
            self.patients = try await self.makeClient().fetchPatients(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil,
                includeDeleted: true
            )
            .map { PatientFieldCrypto.decryptSummary($0, masterKey: self.masterKey) }
            self.statusMessage = "Paziente spostato nel cestino (versione \(acknowledgement.version ?? patient.version + 1))."
        }
    }

    /* @Codex */
    func restorePatient(_ patient: HomeBasePatientSummary) async {
        guard canRestorePatient(patient) else { return }
        guard let sessionCookie, let credentials = pairedCredentials else {
            errorMessage = "Apri prima una sessione paired online."
            return
        }
        await runTask {
            _ = try await self.makeClient().restorePatient(
                id: patient.id,
                version: patient.version,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.patients = try await self.makeClient().fetchPatients(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil,
                includeDeleted: true
            )
            .map { PatientFieldCrypto.decryptSummary($0, masterKey: self.masterKey) }
            self.statusMessage = "Paziente ripristinato dall'home-base."
        }
    }

    /// Seal an encrypted string field for write: empty clears (null); otherwise
    /// JSON-encode (matching JSON.stringify) and encrypt to ENC:. The caller holds
    /// the key, so this never emits plaintext for an encrypted field (.omit on a
    /// crypto failure leaves the stored value untouched rather than clobbering it).
    private func encryptedStringPatchValue(_ text: String, masterKey: SymmetricKey) -> PatchValue<String> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .null }
        guard let json = CryptoService.jsonEncode(trimmed),
              let enc = CryptoService.encryptField(json, masterKey: masterKey) else {
            return .omit
        }
        return .value(enc)
    }

    /// Seal one encrypted clinical sub-resource field for write. Throws if the
    /// operator key is unavailable (refuse the write) or sealing fails, so plaintext
    /// is never persisted into an encrypted column. nil passes through (field
    /// absent/cleared). Called from inside the throwing runTask write closures.
    private func sealField(_ value: String?) throws -> String? {
        guard let masterKey else { throw PairedCryptoError.keyUnavailable }
        switch CryptoService.seal(value, masterKey: masterKey) {
        case .sealed(let sealed): return sealed
        case .failed: throw PairedCryptoError.sealFailed
        }
    }

    /// Seal an already-JSON structured field (metadata) for write: encrypt the JSON
    /// directly (it is already JSON.stringify-d), no extra string-quoting.
    private func sealStructuredField(_ json: String?) throws -> String? {
        guard let masterKey else { throw PairedCryptoError.keyUnavailable }
        guard let json else { return nil }
        guard let enc = CryptoService.encryptField(json, masterKey: masterKey) else {
            throw PairedCryptoError.sealFailed
        }
        return enc
    }

    /// Seal the edited diagnoses (lossless round-trip verified) and encrypt. An
    /// empty list clears the field.
    private func encryptedDiagnosesPatchValue(masterKey: SymmetricKey) -> PatchValue<String> {
        guard let plainJSON = DiagnosesCodec.encode(editPatientDiagnoses, defaultDate: Self.nowISODate()) else {
            return .null
        }
        guard let enc = CryptoService.encryptField(plainJSON, masterKey: masterKey) else {
            return .omit
        }
        return .value(enc)
    }

    /// Seal the edited exemption codes (structured JSON array) and encrypt. An empty
    /// list clears the field (encode returns nil -> .null), matching the diagnoses flow.
    private func encryptedExemptionsPatchValue(masterKey: SymmetricKey) -> PatchValue<String> {
        guard let plainJSON = ExemptionCodesCodec.encode(editPatientExemptions) else {
            return .null
        }
        guard let enc = CryptoService.encryptField(plainJSON, masterKey: masterKey) else {
            return .omit
        }
        return .value(enc)
    }

    static func nowISODate() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    #if DEBUG
    static var isUITestSeeded: Bool {
        ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_PATIENTS"] == "1"
    }

    private func editedPatientDetail(from current: HomeBasePatientDetail) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: current.id,
            firstName: editPatientFirstName.trimmingCharacters(in: .whitespacesAndNewlines),
            lastName: editPatientLastName.trimmingCharacters(in: .whitespacesAndNewlines),
            birthDate: current.birthDate,
            taxCode: editPatientTaxCode.trimmingCharacters(in: .whitespacesAndNewlines),
            address: editPatientAddress.trimmedOrNil,
            phone: editPatientPhone.trimmedOrNil,
            caregiver: editPatientCaregiver.trimmedOrNil,
            exemptions: ExemptionCodesCodec.encode(editPatientExemptions),
            diagnoses: DiagnosesCodec.encode(editPatientDiagnoses, defaultDate: Self.nowISODate()),
            monitoringProfile: current.monitoringProfile,
            statusReason: current.statusReason,
            notes: editPatientNotes.trimmedOrNil,
            aiSummary: current.aiSummary,
            documentInsights: current.documentInsights,
            isAdi: editPatientIsAdi,
            isArchived: editPatientIsArchived,
            version: current.version + 1,
            ambulatoryId: current.ambulatoryId,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        )
    }
    #endif

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
        let content = editEntryContent == editingEntryOriginalContent
            ? nil
            : editEntryContent.trimmingCharacters(in: .whitespacesAndNewlines)
        let type = editEntryType.rawValue
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entryId,
                payload: HomeBaseEntryUpdatePayload(
                    version: version,
                    type: type,
                    title: try self.sealField(title),
                    content: content == nil ? nil : try self.sealField(content)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingEntry()
            self.entries = try await self.fetchDecryptedEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteEntry(id entryId: String, reason: String?) async {
        guard let entry = entries.first(where: { $0.id == entryId }),
              canMutateEntry(entry) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let trimmedReason = reason?.trimmingCharacters(in: .whitespacesAndNewlines).trimmedOrNil
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entry.id,
                payload: HomeBaseEntryUpdatePayload(
                    version: entry.version,
                    deletedAt: Date(),
                    deletionReason: try self.sealField(trimmedReason),
                    shouldEncodeDeletionReason: true
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingEntryId == entry.id {
                self.cancelEditingEntry()
            }
            self.entries = try await self.fetchDecryptedEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario annullata sull'home-base."
        }
    }

    /* @Codex */
    func restoreEntry(id entryId: String) async {
        guard let entry = entries.first(where: { $0.id == entryId }),
              canRestoreEntry(entry) else { return }
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
                    deletedAt: nil,
                    deletionReason: nil,
                    shouldEncodeDeletedAt: true,
                    shouldEncodeDeletionReason: true
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.entries = try await self.fetchDecryptedEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario ripristinata sull'home-base."
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
            self.therapies = try await self.fetchDecryptedTherapies(
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
    /// The selected patient's diagnoses (decoded), for the therapy diagnosis-link picker.
    var currentPatientDiagnoses: [ClinicalDiagnosis] {
        guard let detail = selectedPatient else { return [] }
        return DiagnosesCodec.decode(detail.diagnoses)
    }

    // Resolve the display name for a linked diagnosis code from the patient's diagnoses.
    // diagnosisCode/diagnosisName are PLAINTEXT on therapy (only motivation/deletion_reason
    // are encrypted), so no sealing here.
    private func therapyDiagnosisName(forCode code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        return currentPatientDiagnoses.first { $0.code == code }?.description
    }

    /* @Codex */
    func scheduleNewTherapyDrugCatalogSearch() {
        scheduleDrugCatalogSearch(target: .newTherapy)
    }

    /* @Codex */
    func scheduleEditTherapyDrugCatalogSearch() {
        scheduleDrugCatalogSearch(target: .editTherapy)
    }

    /* @Codex */
    func selectNewTherapyDrugCatalogResult(_ drug: HomeBaseDrugSummary) {
        let draft = CatalogSelection.applying(
            drug,
            to: TherapyCatalogDraft(
                drugName: newTherapyDrugName,
                aic: newTherapyAIC,
                atc: newTherapyATC,
                activePrinciple: newTherapyActivePrinciple
            )
        )
        newTherapyDrugName = draft.drugName
        newTherapyAIC = draft.aic
        newTherapyATC = draft.atc
        newTherapyActivePrinciple = draft.activePrinciple
        resetNewTherapyDrugCatalogSearch(clearAvailability: false)
    }

    /* @Codex */
    func selectEditTherapyDrugCatalogResult(_ drug: HomeBaseDrugSummary) {
        let draft = CatalogSelection.applying(
            drug,
            to: TherapyCatalogDraft(
                drugName: editTherapyDrugName,
                aic: editTherapyAIC,
                atc: editTherapyATC,
                activePrinciple: editTherapyActivePrinciple
            )
        )
        editTherapyDrugName = draft.drugName
        editTherapyAIC = draft.aic
        editTherapyATC = draft.atc
        editTherapyActivePrinciple = draft.activePrinciple
        resetEditTherapyDrugCatalogSearch(clearAvailability: false)
    }

    func createTherapyForSelectedPatient() async {
        guard canCreateTherapy else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let drugName = newTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let aic = newTherapyAIC.trimmedOrNil
        let atc = newTherapyATC.trimmedOrNil
        let activePrinciple = newTherapyActivePrinciple.trimmedOrNil
        let dosage = newTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = newTherapyMotivation.trimmedOrNil
        let endDate = newTherapyHasEndDate ? newTherapyEndDate : nil
        let diagnosisCode = newTherapyDiagnosisCode.trimmedOrNil
        let diagnosisName = therapyDiagnosisName(forCode: diagnosisCode)
        await runTask {
            _ = try await self.makeClient().createTherapy(
                patientId: patientId,
                payload: HomeBaseTherapyCreatePayload(
                    drugName: drugName,
                    aic: aic,
                    atc: atc,
                    activePrinciple: activePrinciple,
                    diagnosisCode: diagnosisCode,
                    diagnosisName: diagnosisName,
                    dosage: dosage,
                    status: self.newTherapyStatus.rawValue,
                    startDate: self.newTherapyStartDate,
                    endDate: endDate,
                    motivation: try self.sealField(motivation)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewTherapyForm()
            self.therapies = try await self.fetchDecryptedTherapies(
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
        editTherapyAIC = therapy.aic ?? ""
        editTherapyATC = therapy.atc ?? ""
        editTherapyActivePrinciple = therapy.activePrinciple ?? ""
        editTherapyDosage = therapy.dosage
        editTherapyMotivation = therapy.motivation ?? ""
        editTherapyStatus = PairedTherapyStatus(rawValue: therapy.status) ?? .active
        editTherapyStartDate = therapy.startDate
        editTherapyHasEndDate = therapy.endDate != nil
        editTherapyEndDate = therapy.endDate ?? Date()
        editTherapyDiagnosisCode = therapy.diagnosisCode ?? ""
        resetEditTherapyDrugCatalogSearch(clearAvailability: false)
        statusMessage = "Modifica terapia pronta."
    }

    /* @Codex */
    func cancelEditingTherapy() {
        editingTherapyId = nil
        editingTherapyVersion = nil
        editTherapyDrugName = ""
        editTherapyAIC = ""
        editTherapyATC = ""
        editTherapyActivePrinciple = ""
        editTherapyDosage = ""
        editTherapyMotivation = ""
        editTherapyStatus = .active
        editTherapyStartDate = Date()
        editTherapyHasEndDate = false
        editTherapyEndDate = Date()
        editTherapyDiagnosisCode = ""
        resetEditTherapyDrugCatalogSearch(clearAvailability: false)
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
        let aic = editTherapyAIC.trimmingCharacters(in: .whitespacesAndNewlines)
        let atc = editTherapyATC.trimmingCharacters(in: .whitespacesAndNewlines)
        let activePrinciple = editTherapyActivePrinciple.trimmingCharacters(in: .whitespacesAndNewlines)
        let dosage = editTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = editTherapyMotivation.trimmingCharacters(in: .whitespacesAndNewlines)
        let diagnosisCode = editTherapyDiagnosisCode.trimmedOrNil
        let diagnosisName = therapyDiagnosisName(forCode: diagnosisCode)
        await runTask {
            let acknowledgement = try await self.makeClient().updateTherapy(
                patientId: patientId,
                therapyId: therapyId,
                payload: HomeBaseTherapyUpdatePayload(
                    version: version,
                    drugName: drugName,
                    aic: aic,
                    atc: atc,
                    activePrinciple: activePrinciple,
                    diagnosisCode: diagnosisCode,
                    diagnosisName: diagnosisName,
                    dosage: dosage,
                    status: self.editTherapyStatus.rawValue,
                    startDate: self.editTherapyStartDate,
                    endDate: self.editTherapyHasEndDate ? self.editTherapyEndDate : nil,
                    shouldEncodeEndDate: true,
                    motivation: try self.sealField(motivation)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingTherapy()
            self.therapies = try await self.fetchDecryptedTherapies(
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
                    deletionReason: try self.sealField("mobile-paired-operator-cancelled")
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingTherapyId == therapy.id {
                self.cancelEditingTherapy()
            }
            self.therapies = try await self.fetchDecryptedTherapies(
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
            self.checkups = try await self.fetchDecryptedCheckups(
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
                    notes: try self.sealField(notes)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewCheckupForm()
            self.checkups = try await self.fetchDecryptedCheckups(
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
                    notes: try self.sealField(notes)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingCheckup()
            self.checkups = try await self.fetchDecryptedCheckups(
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
                    // checkups encrypt only `notes` (lib/db.ts), so deletionReason
                    // stays plaintext to match what the web decrypts.
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
            self.checkups = try await self.fetchDecryptedCheckups(
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
            self.observations = try await self.fetchDecryptedObservations(
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
                    notes: try self.sealField(notes)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewObservationForm()
            self.observations = try await self.fetchDecryptedObservations(
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
                    notes: try self.sealField(notes)
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingObservation()
            self.observations = try await self.fetchDecryptedObservations(
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
                    // observations encrypt only `notes` (lib/db.ts), so deletionReason
                    // stays plaintext to match what the web decrypts.
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
            self.observations = try await self.fetchDecryptedObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione annullata sull'home-base."
        }
    }

    /* @Codex */
    func scheduleNewObservationCodeTerminologySearch() {
        scheduleObservationTerminologySearch(target: .newCode)
    }

    /* @Codex */
    func scheduleNewObservationUnitTerminologySearch() {
        scheduleObservationTerminologySearch(target: .newUnit)
    }

    /* @Codex */
    func scheduleEditObservationCodeTerminologySearch() {
        scheduleObservationTerminologySearch(target: .editCode)
    }

    /* @Codex */
    func scheduleEditObservationUnitTerminologySearch() {
        scheduleObservationTerminologySearch(target: .editUnit)
    }

    /* @Codex */
    func selectNewObservationCodeTerminology(_ item: HomeBaseTerminologyItem) {
        newObservationCode = item.code
        newObservationDisplay = item.display
        resetObservationTerminologySearch(target: .newCode)
    }

    /* @Codex */
    func selectNewObservationUnitTerminology(_ item: HomeBaseTerminologyItem) {
        newObservationUnitCode = item.code
        resetObservationTerminologySearch(target: .newUnit)
    }

    /* @Codex */
    func selectEditObservationCodeTerminology(_ item: HomeBaseTerminologyItem) {
        editObservationCode = item.code
        editObservationDisplay = item.display
        resetObservationTerminologySearch(target: .editCode)
    }

    /* @Codex */
    func selectEditObservationUnitTerminology(_ item: HomeBaseTerminologyItem) {
        editObservationUnitCode = item.code
        resetObservationTerminologySearch(target: .editUnit)
    }

    /* @Codex */
    func loadSelectedPatientServicePrescriptions() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.servicePrescriptions = try await self.fetchServicePrescriptions(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.servicePrescriptionItems = try await self.fetchServicePrescriptionItems(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "\(self.servicePrescriptions.count) prescrizioni di prestazioni caricate."
        }
    }

    /* @Codex */
    func createServicePrescriptionForSelectedPatient() async {
        guard canCreateServicePrescription else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let serviceName = newServiceName.trimmingCharacters(in: .whitespacesAndNewlines)
        let itemDrafts = ServicePrescriptionParsing.parseItemDrafts(newServiceItemsText, fallbackName: serviceName)
        let inheritedCode = itemDrafts.count == 1 ? newServiceCode.trimmedOrNil : nil
        let parentId = UUID().uuidString
        await runTask {
            let created = try await self.makeClient().createServicePrescription(
                payload: HomeBaseServicePrescriptionCreatePayload(
                    id: parentId,
                    patientId: patientId,
                    prescribedAt: self.newServicePrescribedAt,
                    serviceName: serviceName,
                    status: self.newServiceStatus.rawValue,
                    category: self.newServiceCategory.rawValue,
                    priority: self.newServicePriority.rawValue,
                    codeSystem: self.newServiceCodeSystem.trimmedOrNil,
                    serviceCode: self.newServiceCode.trimmedOrNil,
                    clinicalQuestion: self.newServiceClinicalQuestion.trimmedOrNil,
                    provider: self.newServiceProvider.trimmedOrNil,
                    scheduledAt: self.newServiceHasScheduledAt ? self.newServiceScheduledAt : nil,
                    performedAt: self.newServiceHasPerformedAt ? self.newServicePerformedAt : nil,
                    reportReceivedAt: self.newServiceHasReportReceivedAt ? self.newServiceReportReceivedAt : nil,
                    outcomeNote: self.newServiceOutcomeNote.trimmedOrNil,
                    requestReference: self.newServiceRequestReference.trimmedOrNil,
                    source: self.newServiceSource.rawValue,
                    documentRefs: self.newServiceDocumentRefs.trimmedOrNil,
                    notes: self.newServiceNotes.trimmedOrNil
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            let prescriptionId = created.id
            for (index, draft) in itemDrafts.enumerated() {
                _ = try await self.makeClient().createServicePrescriptionItem(
                    payload: HomeBaseServicePrescriptionItemCreatePayload(
                        prescriptionId: prescriptionId,
                        serviceName: draft.serviceName,
                        ordinal: index + 1,
                        status: self.newServiceStatus.rawValue,
                        category: self.newServiceCategory.rawValue,
                        codeSystem: self.newServiceCodeSystem.trimmedOrNil,
                        serviceCode: ServicePrescriptionParsing.childServiceCode(
                            for: draft,
                            inheritedServiceCode: inheritedCode
                        ),
                        matchStatus: draft.serviceCode == nil ? "unmatched" : "manual",
                        scheduledAt: self.newServiceHasScheduledAt ? self.newServiceScheduledAt : nil,
                        performedAt: self.newServiceHasPerformedAt ? self.newServicePerformedAt : nil,
                        reportReceivedAt: self.newServiceHasReportReceivedAt ? self.newServiceReportReceivedAt : nil,
                        outcomeNote: self.newServiceOutcomeNote.trimmedOrNil
                    ),
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            }
            self.resetNewServicePrescriptionForm()
            self.servicePrescriptions = try await self.fetchServicePrescriptions(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.servicePrescriptionItems = try await self.fetchServicePrescriptionItems(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "Prescrizione prestazioni registrata."
        }
    }

    /* @Codex */
    func bookServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) async {
        let scheduledAt = prescription.scheduledAt ?? Date()
        await updateServicePrescriptionWithItems(
            prescription,
            status: .booked,
            parentPayload: HomeBaseServicePrescriptionUpdatePayload(
                version: prescription.version,
                status: PairedServicePrescriptionStatus.booked.rawValue,
                scheduledAt: .value(scheduledAt)
            ),
            childPayload: { item in
                HomeBaseServicePrescriptionItemUpdatePayload(
                    version: item.version,
                    status: PairedServicePrescriptionStatus.booked.rawValue,
                    scheduledAt: .value(item.scheduledAt ?? scheduledAt)
                )
            },
            successMessage: "Prestazione prenotata."
        )
    }

    /* @Codex */
    func performServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) async {
        let performedAt = prescription.performedAt ?? Date()
        await updateServicePrescriptionWithItems(
            prescription,
            status: .performed,
            parentPayload: HomeBaseServicePrescriptionUpdatePayload(
                version: prescription.version,
                status: PairedServicePrescriptionStatus.performed.rawValue,
                performedAt: .value(performedAt)
            ),
            childPayload: { item in
                HomeBaseServicePrescriptionItemUpdatePayload(
                    version: item.version,
                    status: PairedServicePrescriptionStatus.performed.rawValue,
                    performedAt: .value(item.performedAt ?? performedAt)
                )
            },
            successMessage: "Prestazione eseguita."
        )
    }

    /* @Codex */
    func receiveServicePrescriptionReport(_ prescription: HomeBaseServicePrescriptionSummary) async {
        let reportReceivedAt = prescription.reportReceivedAt ?? Date()
        await updateServicePrescriptionWithItems(
            prescription,
            status: .reportReceived,
            parentPayload: HomeBaseServicePrescriptionUpdatePayload(
                version: prescription.version,
                status: PairedServicePrescriptionStatus.reportReceived.rawValue,
                reportReceivedAt: .value(reportReceivedAt)
            ),
            childPayload: { item in
                HomeBaseServicePrescriptionItemUpdatePayload(
                    version: item.version,
                    status: PairedServicePrescriptionStatus.reportReceived.rawValue,
                    reportReceivedAt: .value(item.reportReceivedAt ?? reportReceivedAt)
                )
            },
            successMessage: "Referto prestazione ricevuto."
        )
    }

    /* @Codex */
    func cancelServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) async {
        await updateServicePrescriptionWithItems(
            prescription,
            status: .cancelled,
            parentPayload: HomeBaseServicePrescriptionUpdatePayload(
                version: prescription.version,
                status: PairedServicePrescriptionStatus.cancelled.rawValue
            ),
            childPayload: { item in
                HomeBaseServicePrescriptionItemUpdatePayload(
                    version: item.version,
                    status: PairedServicePrescriptionStatus.cancelled.rawValue
                )
            },
            successMessage: "Prescrizione prestazioni annullata."
        )
    }

    /* @Codex */
    func loadSelectedPatientProstheticPrescriptions() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.prostheticPrescriptions = try await self.fetchProstheticPrescriptions(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "\(self.prostheticPrescriptions.count) prescrizioni protesiche caricate."
        }
    }

    /* @Codex */
    func createProstheticPrescriptionForSelectedPatient() async {
        guard canCreateProstheticPrescription else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let description = newProstheticDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            _ = try await self.makeClient().createProstheticPrescription(
                payload: HomeBaseProstheticPrescriptionCreatePayload(
                    patientId: patientId,
                    prescribedAt: self.newProstheticPrescribedAt,
                    description: description,
                    status: self.newProstheticStatus.rawValue,
                    category: self.newProstheticCategory.rawValue,
                    isoCode: self.newProstheticISOCode.trimmedOrNil,
                    measures: self.newProstheticMeasures.trimmedOrNil,
                    clinicalReason: self.newProstheticClinicalReason.trimmedOrNil,
                    regionalPrescriptionId: self.newProstheticRegionalPrescriptionId.trimmedOrNil,
                    supplier: self.newProstheticSupplier.trimmedOrNil,
                    collaudoAt: self.newProstheticHasCollaudoAt ? self.newProstheticCollaudoAt : nil,
                    collaudoOutcome: self.newProstheticCollaudoOutcome.trimmedOrNil,
                    source: self.newProstheticSource.rawValue,
                    documentRefs: self.newProstheticDocumentRefs.trimmedOrNil,
                    notes: self.newProstheticNotes.trimmedOrNil
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewProstheticPrescriptionForm()
            self.prostheticPrescriptions = try await self.fetchProstheticPrescriptions(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "Prescrizione protesica registrata."
        }
    }

    /* @Codex */
    func markProstheticPrescriptionTested(_ prescription: HomeBaseProstheticPrescriptionSummary) async {
        guard canTestProstheticPrescription(prescription),
              let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else { return }
        await runTask {
            let acknowledgement = try await self.makeClient().updateProstheticPrescription(
                prescriptionId: prescription.id,
                payload: HomeBaseProstheticPrescriptionUpdatePayload(
                    version: prescription.version,
                    status: PairedProstheticPrescriptionStatus.tested.rawValue,
                    collaudoAt: .value(prescription.collaudoAt ?? Date()),
                    collaudoOutcome: .value(prescription.collaudoOutcome ?? "Collaudo registrato in MediFlow.")
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.prostheticPrescriptions = try await self.fetchProstheticPrescriptions(
                patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = "Collaudo registrato."
        }
    }

    /* @Codex */
    func dismissFHIRWarningValidation() {
        pendingFHIRWarningValidation = nil
    }

    /* @Codex */
    func prepareFHIRExport(confirmWarnings: Bool = false) async {
        guard canPrepareFHIRExport,
              let patient = selectedPatient,
              let sessionCookie,
              let credentials = pairedCredentials else { return }
        await runTask {
            let validation = try await self.makeClient().fetchFseValidatePatient(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            let errorCount = validation.totalErrorCount
            let warningCount = validation.totalWarningCount
            if validation.hasErrors {
                self.pendingFHIRWarningValidation = nil
                self.patientFHIRExportURL = nil
                self.statusMessage = "Export FHIR bloccato: \(errorCount) errori FSE da correggere."
                return
            }
            if validation.hasWarnings && !confirmWarnings {
                self.pendingFHIRWarningValidation = validation
                self.statusMessage = "Export FHIR richiede conferma: \(warningCount) avvisi FSE."
                return
            }
            self.pendingFHIRWarningValidation = nil
            let input = FHIRBundleDTOAdapter.input(
                patient: patient,
                entries: self.entries,
                therapies: self.therapies,
                checkups: self.checkups,
                observations: self.observations,
                generatedAt: Self.fhirTimestamp(Date())
            )
            let data = try FHIRBundleDTOAdapter.encodedBundleData(input: input)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(FHIRBundleDTOAdapter.exportFileName(patient: patient))
            try data.write(to: url, options: [.atomic])
            self.patientFHIRExportURL = url
            self.statusMessage = "Export FHIR pronto per la condivisione."
        }
    }

    /* @Codex */
    func checkNetworkRevisionOnForeground() async {
        await checkNetworkRevision(refreshOnChange: true)
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
            patientReportURL = nil
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
            reconciliationLine = "Scritture online dopo accesso operatore. Nessuna coda offline."
            discoveryMessage = nil
            sessionCookie = nil
            masterKey = nil
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

    /* @Codex */
    var clinicalWorkspaceConnection: ClinicalWorkspaceConnection? {
        guard connectionState == .pairedOnline,
              let sessionCookie,
              let credentials = pairedCredentials else {
            return nil
        }
        return ClinicalWorkspaceConnection(
            dataSource: makeClient(),
            credentials: credentials,
            sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId.trimmedOrNil,
            masterKey: masterKey
        )
    }

    /* @Codex */
    private enum TherapyCatalogTarget {
        case newTherapy
        case editTherapy
    }

    /* @Codex */
    private enum ObservationTerminologyTarget {
        case newCode
        case newUnit
        case editCode
        case editUnit

        var system: String {
            switch self {
            case .newCode, .editCode:
                return "LOINC"
            case .newUnit, .editUnit:
                return "UCUM"
            }
        }
    }

    /* @Codex */
    private struct CatalogLookupContext {
        let credentials: HomeBasePairedCredentials
        let sessionCookie: String
        let ambulatoryId: String?
    }

    /* @Codex */
    private static let catalogSearchDebounceNanoseconds: UInt64 = 300_000_000

    /* @Codex */
    private static let catalogMinimumQueryLength = 2

    /* @Codex */
    private var catalogLookupContext: CatalogLookupContext? {
        guard let sessionCookie,
              let credentials = pairedCredentials,
              connectionState == .pairedOnline else {
            return nil
        }
        return CatalogLookupContext(
            credentials: credentials,
            sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId.trimmedOrNil
        )
    }

    /* @Codex */
    private func scheduleDrugCatalogSearch(target: TherapyCatalogTarget) {
        cancelDrugCatalogTask(target)
        guard isDrugCatalogAvailable else {
            setDrugCatalogResults([], target: target)
            setDrugCatalogLoading(false, target: target)
            return
        }
        let query = drugCatalogQuery(target)
        guard query.count >= Self.catalogMinimumQueryLength else {
            setDrugCatalogResults([], target: target)
            setDrugCatalogLoading(false, target: target)
            return
        }
        let task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.catalogSearchDebounceNanoseconds)
            guard !Task.isCancelled else { return }
            await self?.performDrugCatalogSearch(query: query, target: target)
        }
        switch target {
        case .newTherapy:
            newTherapyDrugCatalogTask = task
        case .editTherapy:
            editTherapyDrugCatalogTask = task
        }
    }

    /* @Codex */
    private func performDrugCatalogSearch(query: String, target: TherapyCatalogTarget) async {
        guard drugCatalogQuery(target) == query,
              let context = catalogLookupContext else {
            setDrugCatalogResults([], target: target)
            setDrugCatalogLoading(false, target: target)
            return
        }
        setDrugCatalogLoading(true, target: target)
        defer { setDrugCatalogLoading(false, target: target) }
        do {
            let results = try await makeClient().searchDrugs(
                query: query,
                limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                credentials: context.credentials,
                sessionCookie: context.sessionCookie,
                ambulatoryId: context.ambulatoryId
            )
            guard drugCatalogQuery(target) == query else { return }
            setDrugCatalogResults(results, target: target)
            drugCatalogStatusMessage = nil
        } catch {
            markDrugCatalogUnavailable()
        }
    }

    /* @Codex */
    private func performExemptionCatalogSearch(query: String) async {
        guard newExemptionCode.trimmingCharacters(in: .whitespacesAndNewlines) == query,
              let context = catalogLookupContext else {
            exemptionCatalogResults = []
            isSearchingExemptionCatalog = false
            return
        }
        isSearchingExemptionCatalog = true
        defer { isSearchingExemptionCatalog = false }
        do {
            let results = try await makeClient().searchExemptions(
                query: query,
                limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                credentials: context.credentials,
                sessionCookie: context.sessionCookie,
                ambulatoryId: context.ambulatoryId
            )
            guard newExemptionCode.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            exemptionCatalogResults = results
            exemptionCatalogStatusMessage = nil
        } catch {
            markExemptionCatalogUnavailable()
        }
    }

    /* @Codex */
    private func scheduleObservationTerminologySearch(target: ObservationTerminologyTarget) {
        cancelObservationTerminologyTask(target)
        guard isTerminologySearchAvailable else {
            setObservationTerminologyResults([], target: target)
            setObservationTerminologyLoading(false, target: target)
            return
        }
        let query = observationTerminologyQuery(target)
        guard query.count >= 2 else {
            setObservationTerminologyResults([], target: target)
            setObservationTerminologyLoading(false, target: target)
            return
        }
        let task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.performObservationTerminologySearch(query: query, target: target)
        }
        setObservationTerminologyTask(task, target: target)
    }

    /* @Codex */
    private func performObservationTerminologySearch(query: String, target: ObservationTerminologyTarget) async {
        guard observationTerminologyQuery(target) == query,
              let context = catalogLookupContext else {
            setObservationTerminologyResults([], target: target)
            setObservationTerminologyLoading(false, target: target)
            return
        }
        setObservationTerminologyLoading(true, target: target)
        defer { setObservationTerminologyLoading(false, target: target) }
        do {
            let results = try await makeClient().searchTerminology(
                system: target.system,
                query: query,
                limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                credentials: context.credentials,
                sessionCookie: context.sessionCookie,
                ambulatoryId: context.ambulatoryId
            )
            guard observationTerminologyQuery(target) == query else { return }
            setObservationTerminologyResults(results, target: target)
        } catch {
            markTerminologySearchUnavailable()
        }
    }

    /* @Codex */
    private func drugCatalogQuery(_ target: TherapyCatalogTarget) -> String {
        let raw = target == .newTherapy ? newTherapyDrugName : editTherapyDrugName
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /* @Codex */
    private func observationTerminologyQuery(_ target: ObservationTerminologyTarget) -> String {
        switch target {
        case .newCode:
            return newObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        case .newUnit:
            return newObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        case .editCode:
            return editObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        case .editUnit:
            return editObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    /* @Codex */
    private func setDrugCatalogResults(_ results: [HomeBaseDrugSummary], target: TherapyCatalogTarget) {
        switch target {
        case .newTherapy:
            newTherapyDrugCatalogResults = results
        case .editTherapy:
            editTherapyDrugCatalogResults = results
        }
    }

    /* @Codex */
    private func setDrugCatalogLoading(_ isLoading: Bool, target: TherapyCatalogTarget) {
        switch target {
        case .newTherapy:
            isSearchingNewTherapyDrugCatalog = isLoading
        case .editTherapy:
            isSearchingEditTherapyDrugCatalog = isLoading
        }
    }

    /* @Codex */
    private func setObservationTerminologyResults(_ results: [HomeBaseTerminologyItem], target: ObservationTerminologyTarget) {
        switch target {
        case .newCode:
            newObservationCodeTerminologyResults = results
        case .newUnit:
            newObservationUnitTerminologyResults = results
        case .editCode:
            editObservationCodeTerminologyResults = results
        case .editUnit:
            editObservationUnitTerminologyResults = results
        }
    }

    /* @Codex */
    private func setObservationTerminologyLoading(_ isLoading: Bool, target: ObservationTerminologyTarget) {
        switch target {
        case .newCode:
            isSearchingNewObservationCodeTerminology = isLoading
        case .newUnit:
            isSearchingNewObservationUnitTerminology = isLoading
        case .editCode:
            isSearchingEditObservationCodeTerminology = isLoading
        case .editUnit:
            isSearchingEditObservationUnitTerminology = isLoading
        }
    }

    /* @Codex */
    private func cancelDrugCatalogTask(_ target: TherapyCatalogTarget) {
        switch target {
        case .newTherapy:
            newTherapyDrugCatalogTask?.cancel()
            newTherapyDrugCatalogTask = nil
        case .editTherapy:
            editTherapyDrugCatalogTask?.cancel()
            editTherapyDrugCatalogTask = nil
        }
    }

    /* @Codex */
    private func setObservationTerminologyTask(_ task: Task<Void, Never>?, target: ObservationTerminologyTarget) {
        switch target {
        case .newCode:
            newObservationCodeTerminologyTask = task
        case .newUnit:
            newObservationUnitTerminologyTask = task
        case .editCode:
            editObservationCodeTerminologyTask = task
        case .editUnit:
            editObservationUnitTerminologyTask = task
        }
    }

    /* @Codex */
    private func cancelObservationTerminologyTask(_ target: ObservationTerminologyTarget) {
        switch target {
        case .newCode:
            newObservationCodeTerminologyTask?.cancel()
            newObservationCodeTerminologyTask = nil
        case .newUnit:
            newObservationUnitTerminologyTask?.cancel()
            newObservationUnitTerminologyTask = nil
        case .editCode:
            editObservationCodeTerminologyTask?.cancel()
            editObservationCodeTerminologyTask = nil
        case .editUnit:
            editObservationUnitTerminologyTask?.cancel()
            editObservationUnitTerminologyTask = nil
        }
    }

    /* @Codex */
    private func markDrugCatalogUnavailable() {
        isDrugCatalogAvailable = false
        newTherapyDrugCatalogResults = []
        editTherapyDrugCatalogResults = []
        isSearchingNewTherapyDrugCatalog = false
        isSearchingEditTherapyDrugCatalog = false
        drugCatalogStatusMessage = "Catalogo non disponibile, inserimento manuale"
    }

    /* @Codex */
    private func markExemptionCatalogUnavailable() {
        isExemptionCatalogAvailable = false
        exemptionCatalogResults = []
        isSearchingExemptionCatalog = false
        exemptionCatalogStatusMessage = "Catalogo non disponibile, inserimento manuale"
    }

    /* @Codex */
    private func markTerminologySearchUnavailable() {
        isTerminologySearchAvailable = false
        for target in [ObservationTerminologyTarget.newCode, .newUnit, .editCode, .editUnit] {
            setObservationTerminologyResults([], target: target)
            setObservationTerminologyLoading(false, target: target)
        }
    }

    /* @Codex */
    private func resetNewTherapyDrugCatalogSearch(clearAvailability: Bool) {
        newTherapyDrugCatalogTask?.cancel()
        newTherapyDrugCatalogTask = nil
        newTherapyDrugCatalogResults = []
        isSearchingNewTherapyDrugCatalog = false
        if clearAvailability {
            isDrugCatalogAvailable = true
            drugCatalogStatusMessage = nil
        }
    }

    /* @Codex */
    private func resetEditTherapyDrugCatalogSearch(clearAvailability: Bool) {
        editTherapyDrugCatalogTask?.cancel()
        editTherapyDrugCatalogTask = nil
        editTherapyDrugCatalogResults = []
        isSearchingEditTherapyDrugCatalog = false
        if clearAvailability {
            isDrugCatalogAvailable = true
            drugCatalogStatusMessage = nil
        }
    }

    /* @Codex */
    private func resetExemptionCatalogSearch(clearAvailability: Bool) {
        exemptionCatalogTask?.cancel()
        exemptionCatalogTask = nil
        exemptionCatalogResults = []
        isSearchingExemptionCatalog = false
        if clearAvailability {
            isExemptionCatalogAvailable = true
            exemptionCatalogStatusMessage = nil
        }
    }

    /* @Codex */
    private func resetObservationTerminologySearch(target: ObservationTerminologyTarget) {
        cancelObservationTerminologyTask(target)
        setObservationTerminologyResults([], target: target)
        setObservationTerminologyLoading(false, target: target)
    }

    /* @Codex */
    private func resetCatalogAvailability() {
        resetNewTherapyDrugCatalogSearch(clearAvailability: true)
        resetEditTherapyDrugCatalogSearch(clearAvailability: true)
        resetExemptionCatalogSearch(clearAvailability: true)
        for target in [ObservationTerminologyTarget.newCode, .newUnit, .editCode, .editUnit] {
            resetObservationTerminologySearch(target: target)
        }
        isTerminologySearchAvailable = true
    }

    // ADR 0071 Fase 3: returns the data-source SEAM (any HomeBasePatientsDataSource),
    // not the concrete HTTP actor, so the implementation can be swapped for the
    // in-process SQLite-backed adapter without touching the call sites.
    //
    // Opt-in local authority (MEDIFLOW_LOCAL_AUTHORITY): when enabled AND the field
    // key is unlocked, patient list/detail are served from the on-device medical.db
    // via LocalPatientsDataSource (the reversed-flow read path drives the app);
    // everything else still delegates to the HTTP client. OFF by default -> the app's
    // behavior is unchanged unless the flag is set.
    private func makeClient() -> any HomeBasePatientsDataSource {
        if let dataSourceFactory {
            return dataSourceFactory(self)
        }
        let http = HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: serverURL, tlsPin: tlsPin))
        guard Self.localAuthorityEnabled, let masterKey else { return http }
        let dbPath = HomeBaseRuntimeStatusLoader.defaultDataDirectoryURL()
            .appendingPathComponent("medical.db").path
        return LocalPatientsDataSource(databasePath: dbPath, masterKey: masterKey, fallback: http)
    }

    private static var localAuthorityEnabled: Bool {
        let raw = ProcessInfo.processInfo.environment["MEDIFLOW_LOCAL_AUTHORITY"]?.lowercased()
        return raw == "1" || raw == "true" || raw == "yes"
    }

    /* @Codex */
    private static func fhirTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    // Fetch + decrypt the clinical sub-resources so their encrypted fields display
    // as plaintext. Same signature as the client methods, so call sites swap the
    // client call for these verbatim.
    private func fetchDecryptedEntries(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseEntrySummary] {
        try await makeClient().fetchEntries(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .map { ClinicalFieldCrypto.decryptEntry($0, masterKey: masterKey) }
    }

    private func fetchDecryptedTherapies(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseTherapySummary] {
        try await makeClient().fetchTherapies(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .map { ClinicalFieldCrypto.decryptTherapy($0, masterKey: masterKey) }
    }

    private func fetchDecryptedCheckups(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseCheckupSummary] {
        try await makeClient().fetchCheckups(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .map { ClinicalFieldCrypto.decryptCheckup($0, masterKey: masterKey) }
    }

    private func fetchDecryptedObservations(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseObservationSummary] {
        try await makeClient().fetchObservations(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .map { ClinicalFieldCrypto.decryptObservation($0, masterKey: masterKey) }
    }

    /* @Codex */
    private func fetchServicePrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionSummary] {
        let rows = try await makeClient().fetchServicePrescriptions(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        return ServicePrescriptionFiltering.sorted(rows)
    }

    /* @Codex */
    private func fetchServicePrescriptionItems(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        let rows = try await makeClient().fetchServicePrescriptionItems(
            patientId: patientId, prescriptionId: nil,
            credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        return ServicePrescriptionFiltering.sortedItems(rows)
    }

    /* @Codex */
    private func fetchProstheticPrescriptions(patientId: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        let rows = try await makeClient().fetchProstheticPrescriptions(
            patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        return ProstheticPrescriptionFiltering.sorted(rows)
    }

    /* @Codex */
    func generatePatientReportPDF() {
        guard let detail = selectedPatient else {
            errorMessage = "Apri prima un paziente."
            return
        }
        do {
            let now = Date()
            let content = PatientReportDocument.build(
                patient: detail,
                entries: entries,
                therapies: therapies,
                checkups: checkups,
                observations: observations,
                generatedAt: now,
                referenceDate: now
            )
            patientReportURL = try PatientReportPDFRenderer.render(content)
            statusMessage = "Report PDF pronto per la condivisione."
        } catch {
            errorMessage = "Report PDF non generato: \(error.localizedDescription)"
        }
    }

    /* @Codex */
    private func updateServicePrescriptionWithItems(
        _ prescription: HomeBaseServicePrescriptionSummary,
        status: PairedServicePrescriptionStatus,
        parentPayload: HomeBaseServicePrescriptionUpdatePayload,
        childPayload: @escaping (HomeBaseServicePrescriptionItemSummary) -> HomeBaseServicePrescriptionItemUpdatePayload,
        successMessage: String
    ) async {
        guard canMutateServicePrescription(prescription),
              selectedPatient?.id == prescription.patientId,
              let sessionCookie,
              let credentials = pairedCredentials else { return }
        switch status {
        case .booked where !canBookServicePrescription(prescription): return
        case .performed where !canPerformServicePrescription(prescription): return
        case .reportReceived where !canReceiveReportServicePrescription(prescription): return
        case .cancelled where !canCancelServicePrescription(prescription): return
        default: break
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateServicePrescription(
                prescriptionId: prescription.id,
                payload: parentPayload,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            let children = self.servicePrescriptionItems.filter { $0.prescriptionId == prescription.id }
            for item in children {
                let itemAcknowledgement = try await self.makeClient().updateServicePrescriptionItem(
                    itemId: item.id,
                    payload: childPayload(item),
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
                guard itemAcknowledgement.success else { throw HomeBaseClientError.contract }
            }
            self.servicePrescriptions = try await self.fetchServicePrescriptions(
                patientId: prescription.patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.servicePrescriptionItems = try await self.fetchServicePrescriptionItems(
                patientId: prescription.patientId, credentials: credentials, sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil)
            self.statusMessage = successMessage
        }
    }

    /* @Codex */
    private func checkNetworkRevision(refreshOnChange: Bool) async {
        guard connectionState == .pairedOnline,
              let sessionCookie,
              let credentials = pairedCredentials else { return }
        do {
            let revision = try await makeClient().fetchNetworkRevision(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId.trimmedOrNil
            )
            guard self.lastSeenNetworkFingerprint != nil else {
                lastSeenNetworkFingerprint = revision.fingerprint
                return
            }
            guard refreshOnChange, lastSeenNetworkFingerprint != revision.fingerprint else { return }
            lastSeenNetworkFingerprint = revision.fingerprint
            try await refreshCurrentWorkspaceAfterRevision(
                credentials: credentials,
                sessionCookie: sessionCookie
            )
            statusMessage = "Home-base aggiornato, dati ricaricati."
        } catch {
            // Revision polling must not interrupt manual work when the Mac is offline.
        }
    }

    /* @Codex */
    private func refreshCurrentWorkspaceAfterRevision(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws {
        if let current = selectedPatient {
            let patientId = current.id
            let fetchedDetail = try await makeClient().fetchPatient(
                id: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId.trimmedOrNil
            )
            selectedPatient = PatientFieldCrypto.decryptDetail(fetchedDetail, masterKey: masterKey)
            entries = try await fetchDecryptedEntries(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            therapies = try await fetchDecryptedTherapies(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            checkups = try await fetchDecryptedCheckups(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            observations = try await fetchDecryptedObservations(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            servicePrescriptions = try await fetchServicePrescriptions(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            servicePrescriptionItems = try await fetchServicePrescriptionItems(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            prostheticPrescriptions = try await fetchProstheticPrescriptions(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId.trimmedOrNil)
            patientReportURL = nil
            patientFHIRExportURL = nil
        } else {
            patients = try await makeClient().fetchPatients(
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: ambulatoryId.trimmedOrNil,
                includeDeleted: false
            )
            .map { PatientFieldCrypto.decryptSummary($0, masterKey: masterKey) }
        }
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
                : "Snapshot locale pronto. Scritture online dopo accesso operatore."
            return true
        } catch {
            errorMessage = "Cache locale non leggibile: \(error.localizedDescription)"
            return false
        }
    }

    private func runTask(_ operation: @escaping () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        pendingConflict = nil
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            if case HomeBaseClientError.httpStatus(let status, _) = error,
               status == 401 {
                connectionState = .sessionExpired
                sessionCookie = nil
                masterKey = nil
                statusMessage = "Sessione operatore scaduta. Accedi di nuovo per scrivere sul Mac."
            } else if case HomeBaseClientError.httpStatus(let status, _) = error,
                      status == 403 {
                statusMessage = "Operazione non autorizzata nello scope paired corrente."
            } else if case HomeBaseClientError.versionConflict(let payload) = error {
                // Typed 409: surface the structured conflict so the reconciliation
                // banner can show expected-vs-current and offer a reload.
                pendingConflict = payload
                statusMessage = error.localizedDescription
                errorMessage = nil
                return
            } else if case HomeBaseClientError.pinChangeConflict = error {
                statusMessage = error.localizedDescription
                errorMessage = nil
                return
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
        newTherapyAIC = ""
        newTherapyATC = ""
        newTherapyActivePrinciple = ""
        newTherapyDosage = ""
        newTherapyMotivation = ""
        newTherapyStatus = .active
        newTherapyStartDate = Date()
        newTherapyHasEndDate = false
        newTherapyEndDate = Date()
        newTherapyDiagnosisCode = ""
        resetNewTherapyDrugCatalogSearch(clearAvailability: false)
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
        resetObservationTerminologySearch(target: .newCode)
        resetObservationTerminologySearch(target: .newUnit)
    }

    /* @Codex */
    private func resetNewServicePrescriptionForm() {
        newServicePrescribedAt = Date()
        newServiceStatus = .prescribed
        newServiceCategory = .specialistica
        newServicePriority = .p
        newServiceCodeSystem = "NTR"
        newServiceCode = ""
        newServiceName = ""
        newServiceClinicalQuestion = ""
        newServiceProvider = ""
        newServiceHasScheduledAt = false
        newServiceScheduledAt = Date()
        newServiceHasPerformedAt = false
        newServicePerformedAt = Date()
        newServiceHasReportReceivedAt = false
        newServiceReportReceivedAt = Date()
        newServiceOutcomeNote = ""
        newServiceRequestReference = ""
        newServiceSource = .manual
        newServiceDocumentRefs = ""
        newServiceNotes = ""
        newServiceItemsText = ""
    }

    /* @Codex */
    private func resetNewProstheticPrescriptionForm() {
        newProstheticPrescribedAt = Date()
        newProstheticStatus = .prescribed
        newProstheticCategory = .ausilio
        newProstheticISOCode = ""
        newProstheticDescription = ""
        newProstheticMeasures = ""
        newProstheticClinicalReason = ""
        newProstheticRegionalPrescriptionId = ""
        newProstheticSupplier = ""
        newProstheticHasCollaudoAt = false
        newProstheticCollaudoAt = Date()
        newProstheticCollaudoOutcome = ""
        newProstheticSource = .manual
        newProstheticDocumentRefs = ""
        newProstheticNotes = ""
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
    var canCreateServicePrescription: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newServiceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canCreateProstheticPrescription: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newProstheticDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canPrepareFHIRExport: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
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
    func canRestoreEntry(_ entry: HomeBaseEntrySummary) -> Bool {
        entry.deletedAt != nil
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

    /* @Codex */
    func canMutateServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) -> Bool {
        selectedPatient?.id == prescription.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canBookServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) -> Bool {
        canMutateServicePrescription(prescription)
            && prescription.status == PairedServicePrescriptionStatus.prescribed.rawValue
    }

    /* @Codex */
    func canPerformServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) -> Bool {
        canMutateServicePrescription(prescription)
            && [
                PairedServicePrescriptionStatus.prescribed.rawValue,
                PairedServicePrescriptionStatus.booked.rawValue,
            ].contains(prescription.status)
    }

    /* @Codex */
    func canReceiveReportServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) -> Bool {
        canMutateServicePrescription(prescription)
            && prescription.status != PairedServicePrescriptionStatus.reportReceived.rawValue
            && prescription.status != PairedServicePrescriptionStatus.cancelled.rawValue
    }

    /* @Codex */
    func canCancelServicePrescription(_ prescription: HomeBaseServicePrescriptionSummary) -> Bool {
        canMutateServicePrescription(prescription)
            && prescription.status != PairedServicePrescriptionStatus.cancelled.rawValue
            && prescription.status != PairedServicePrescriptionStatus.performed.rawValue
            && prescription.status != PairedServicePrescriptionStatus.reportReceived.rawValue
    }

    /* @Codex */
    func canTestProstheticPrescription(_ prescription: HomeBaseProstheticPrescriptionSummary) -> Bool {
        selectedPatient?.id == prescription.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && prescription.status != PairedProstheticPrescriptionStatus.tested.rawValue
            && prescription.status != PairedProstheticPrescriptionStatus.cancelled.rawValue
            && !isWorking
    }
}

/// Field-crypto failures surfaced to the operator when a write cannot be sealed.
enum PairedCryptoError: LocalizedError {
    case keyUnavailable
    case sealFailed

    var errorDescription: String? {
        switch self {
        case .keyUnavailable:
            return "Cifratura non disponibile: riaccedi con il PIN operatore prima di salvare."
        case .sealFailed:
            return "Cifratura del campo non riuscita: riprova."
        }
    }
}

/* @Codex */
extension HomeBaseValidatePatientExportResponse {
    var totalErrorCount: Int {
        therapyMedication.errorCount + observationVitals.errorCount
    }

    var totalWarningCount: Int {
        therapyMedication.warningCount + observationVitals.warningCount
    }
}
