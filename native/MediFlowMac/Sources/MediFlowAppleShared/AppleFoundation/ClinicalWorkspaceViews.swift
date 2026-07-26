import CryptoKit
import SwiftUI
import MediFlowCore

/* @Codex */
struct ClinicalWorkspaceConnection {
    struct Identity: Hashable {
        let clientId: String
        let clientToken: String
        let sessionCookie: String
        let ambulatoryId: String?
    }

    let dataSource: any HomeBasePatientsDataSource
    let credentials: HomeBasePairedCredentials
    let sessionCookie: String
    let ambulatoryId: String?
    let masterKey: SymmetricKey?

    var identity: Identity {
        Identity(
            clientId: credentials.clientId,
            clientToken: credentials.clientToken,
            sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId
        )
    }
}

/* @Codex */
enum ClinicalWorkspaceLoadState: Equatable {
    case idle
    case loading
    case loaded
    case unavailable(String)
    case failed(String)
}

/// What a list section should say, given the load state and whether the read
/// came back with anything.
///
/// This exists because the three cross-patient views each wrote the decision
/// inline as an `if` chain ending in `rows.isEmpty`, and that chain let `.idle`
/// and `.unavailable` fall through to the empty-result sentence. The Agenda
/// therefore stated "Nessuna visita pianificata." at moments when it had not
/// read the archive at all — in demo mode, where the capability gate is forced
/// open while the connection is nil, that was simply what the screen said. A
/// false statement about a clinical archive is not a presentation defect.
///
/// Written inline it was also untestable: a suite of 32 UI tests passed with
/// that sentence on screen. As a value, the mapping can be asserted directly,
/// including the case that matters — an unread archive must never be described
/// as an empty one.
enum ClinicalWorkspaceSectionContent: Equatable {
    case progress
    case message(String)
    case rows

    init(state: ClinicalWorkspaceLoadState, isEmpty: Bool, idleMessage: String, emptyMessage: String) {
        switch state {
        case .loading:
            self = .progress
        case .failed(let message), .unavailable(let message):
            self = .message(message)
        case .idle:
            self = .message(idleMessage)
        case .loaded:
            self = isEmpty ? .message(emptyMessage) : .rows
        }
    }
}

/* @Codex */
@MainActor
final class ClinicalWorkspaceCapabilitiesStore: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    private var availableKeys = Set<String>()
    private var loadedConnectionIdentity: ClinicalWorkspaceConnection.Identity?
    private var requestGeneration: UInt64 = 0

    func loadIfNeeded(using connection: ClinicalWorkspaceConnection?) async {
        #if DEBUG
        // Offline demo: there is no host to interrogate, so every capability the
        // UI gates on is reported available. Without this the demo dataset loads
        // but Agenda, Diario, Analytics and Scale all render "collega
        // l'home-base" and cannot be worked on at all.
        if AppleFoundationDemoMode.isActive {
            availableKeys = Set(Self.demoCapabilityKeys)
            loadedConnectionIdentity = connection?.identity
            state = .loaded
            return
        }
        #endif
        guard let connection else {
            requestGeneration &+= 1
            availableKeys.removeAll()
            loadedConnectionIdentity = nil
            state = .unavailable("Collega l'home-base per verificare le capability disponibili.")
            return
        }
        let connectionIdentity = connection.identity
        guard loadedConnectionIdentity != connectionIdentity || state != .loaded else { return }
        requestGeneration &+= 1
        let generation = requestGeneration
        availableKeys.removeAll()
        loadedConnectionIdentity = nil
        state = .loading
        do {
            let response = try await connection.dataSource.fetchNetworkCapabilities(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId
            )
            guard requestGeneration == generation else { return }
            availableKeys = Set(response.capabilities.compactMap { capability in
                capability.status == "available" ? capability.key : nil
            })
            loadedConnectionIdentity = connectionIdentity
            state = .loaded
        } catch {
            guard requestGeneration == generation else { return }
            if Task.isCancelled {
                state = .idle
                return
            }
            state = .failed("Non è stato possibile verificare le capability dell'host: \(error.localizedDescription)")
        }
    }

    #if DEBUG
    /// Every key the clinical surfaces gate on. Kept beside the gate itself so a
    /// new gated capability that is not listed here shows up as a dead surface in
    /// the demo, rather than silently.
    static let demoCapabilityKeys = [
        "network.ambulatories.write",
        "network.compute.visit-draft",
        "network.replica.readonly-agenda",
        "network.replica.readonly-clinical-diary-global",
        "network.replica.readonly-documents",
        "network.replica.readonly-patients",
        "network.replica.write-documents"
    ]
    #endif

    func hasCapability(_ key: String) -> Bool {
        availableKeys.contains(key)
    }

    func unavailableMessage(for key: String) -> String? {
        guard state == .loaded, !availableKeys.contains(key) else { return nil }
        switch key {
        case "network.replica.readonly-agenda":
            return "L'host collegato non espone ancora l'agenda cross-paziente (capability network.replica.readonly-agenda). Aggiorna MediFlow sull'host."
        case "network.replica.readonly-clinical-diary-global":
            return "L'host collegato non espone ancora il diario clinico globale (capability network.replica.readonly-clinical-diary-global). Aggiorna MediFlow sull'host."
        case "network.ambulatories.write":
            return "L'host collegato non espone la gestione ambulatori. Il pairing potrebbe essere precedente: esegui di nuovo il pairing dopo aver aggiornato MediFlow sull'host."
        case "network.replica.readonly-documents":
            return "L'host o il pairing corrente non espongono ancora l'archivio documenti. Aggiorna MediFlow sull'host e ripeti il pairing."
        case "network.replica.write-documents":
            return "L'host collegato non espone il caricamento documenti. Il pairing potrebbe essere precedente: esegui di nuovo il pairing dopo aver aggiornato MediFlow sull'host."
        case "network.compute.visit-draft":
            return "L'host o il pairing corrente non espongono ancora l'elaborazione della bozza visita. Aggiorna MediFlow sull'host e ripeti il pairing."
        default:
            return "L'host collegato non espone ancora la lettura pazienti richiesta (capability \(key)). Aggiorna MediFlow sull'host."
        }
    }
}

/* @Codex */
struct AgendaWorkspaceRow: Identifiable, Equatable {
    let checkup: AgendaCheckup
    let patientName: String
    let presentation: AgendaPillPresentation
    var id: String { checkup.id }
}

/* @Codex */
@MainActor
final class AgendaWorkspaceModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var rows: [AgendaWorkspaceRow] = []
    @Published private(set) var todayCount = 0
    @Published private(set) var plannedCount = 0
    @Published private(set) var activePatientCount = 0

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private let now: () -> Date

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?, now: @escaping () -> Date = Date.init) {
        self.connectionProvider = connectionProvider
        self.now = now
    }

    func load() async {
        guard let connection = connectionProvider() else {
            state = .unavailable("Collega l'home-base prima di caricare l'agenda.")
            return
        }
        state = .loading
        do {
            let currentDate = now()
            async let patientsRequest = connection.dataSource.fetchPatients(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId,
                includeDeleted: true
            )
            async let checkupsRequest = connection.dataSource.fetchScopedCheckups(
                dateFrom: Calendar.current.startOfDay(for: currentDate),
                dateTo: nil,
                status: [],
                limit: 500,
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId
            )
            let patients = try await patientsRequest
            let checkups = try await checkupsRequest
            let names = Dictionary(patients.map { ($0.id, "\($0.firstName) \($0.lastName)") }, uniquingKeysWith: { first, _ in first })
            let agendaCheckups = checkups.map { AgendaCheckup(id: $0.id, patientId: $0.patientId, date: $0.date, status: $0.status) }
            rows = AgendaPresentation.agendaCandidates(from: agendaCheckups, now: currentDate).map { checkup in
                AgendaWorkspaceRow(
                    checkup: checkup,
                    patientName: names[checkup.patientId] ?? "Paziente non trovato",
                    presentation: AgendaPresentation.classifyCheckupPill(date: checkup.date, status: checkup.status, now: currentDate)
                )
            }
            todayCount = AgendaPresentation.countTodayCheckups(agendaCheckups, now: currentDate)
            plannedCount = AgendaPresentation.countPlannedCheckups(agendaCheckups, now: currentDate)
            activePatientCount = patients.filter { $0.isArchived != true && $0.deletedAt == nil }.count
            state = .loaded
        } catch {
            state = .failed("Impossibile caricare l'agenda: \(error.localizedDescription)")
        }
    }
}

/* @Codex */
struct GlobalDiaryWorkspaceRow: Identifiable, Equatable {
    let item: GlobalDiaryItem
    let date: Date
    let type: String
    let attachmentCount: Int
    /// Which fields this session could not open.
    ///
    /// `GlobalDiaryItem` is built from the decrypted strings, and an unreadable
    /// field arrives there as `""` — at which point the presentation layer fills
    /// the blank with "Voce diario" and "Voce senza testo clinico.". Those are
    /// the words for an entry someone left empty, and they are read that way.
    /// Carrying the lock alongside the item lets the row say the true thing
    /// instead: the note exists on the host, this device cannot read it.
    let lockedFields: LockedClinicalFields
    var id: String { item.id }
}

/* @Codex */
@MainActor
final class GlobalDiaryWorkspaceModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var rows: [GlobalDiaryWorkspaceRow] = []
    @Published private(set) var activeCount = 0
    @Published private(set) var patientCount = 0

    private let connectionProvider: () -> ClinicalWorkspaceConnection?

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?) {
        self.connectionProvider = connectionProvider
    }

    func load() async {
        guard let connection = connectionProvider() else {
            state = .unavailable("Collega l'home-base prima di caricare il diario globale.")
            return
        }
        state = .loading
        do {
            async let patientsRequest = connection.dataSource.fetchPatients(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId,
                includeDeleted: true
            )
            async let entriesRequest = connection.dataSource.fetchScopedEntries(
                type: nil,
                dateFrom: nil,
                dateTo: nil,
                limit: 50,
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId
            )
            let patients = try await patientsRequest
            let encryptedEntries = try await entriesRequest
            let entries = encryptedEntries.map { ClinicalFieldCrypto.decryptEntry($0, masterKey: connection.masterKey) }
            let presentation = GlobalDiaryPresentation.buildState(
                entries: entries.map {
                    GlobalDiaryEntry(id: $0.id, patientId: $0.patientId, title: $0.title, content: $0.content, deletedAt: $0.deletedAt)
                },
                patients: patients.map { GlobalDiaryPatient(id: $0.id, name: "\($0.firstName) \($0.lastName)", code: $0.taxCode) }
            )
            let entryByID = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            rows = presentation.entries.compactMap { item in
                guard let entry = entryByID[item.id] else { return nil }
                return GlobalDiaryWorkspaceRow(
                    item: item,
                    date: entry.date,
                    type: entry.type,
                    attachmentCount: Self.attachmentCount(entry.attachments),
                    lockedFields: entry.lockedFields
                )
            }
            activeCount = presentation.activeCount
            patientCount = presentation.patientCount
            state = .loaded
        } catch {
            state = .failed("Impossibile caricare il diario globale: \(error.localizedDescription)")
        }
    }

    private static func attachmentCount(_ attachments: String?) -> Int {
        guard let attachments,
              let data = attachments.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return 0 }
        return values.count
    }
}

/* @Codex */
@MainActor
final class PopulationAnalyticsWorkspaceModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var statistics: PopulationAnalyticsStats?
    @Published var minimumAge = 0 { didSet { normalizeRange() } }
    @Published var maximumAge = 120 { didSet { normalizeRange() } }

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private let now: () -> Date

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?, now: @escaping () -> Date = Date.init) {
        self.connectionProvider = connectionProvider
        self.now = now
    }

    func load() async {
        guard let connection = connectionProvider() else {
            state = .unavailable("Collega l'home-base prima di caricare gli analytics.")
            return
        }
        state = .loading
        do {
            let summaries = try await connection.dataSource.fetchPatients(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId,
                includeDiagnoses: true
            )
            let patients = summaries
                .filter { $0.isArchived != true && $0.deletedAt == nil }
                .map { summary in
                    let decrypted = PatientFieldCrypto.decryptSummary(summary, masterKey: connection.masterKey)
                    return PopulationPatient(
                        id: decrypted.id,
                        birthDate: decrypted.birthDate,
                        isAdi: decrypted.isAdi,
                        diagnoses: DiagnosesCodec.decode(decrypted.diagnoses)
                    )
                }
            statistics = PopulationAnalytics.statistics(
                for: patients,
                ageRange: (minimumAge, maximumAge),
                now: now()
            )
            state = .loaded
        } catch {
            state = .failed("Impossibile caricare gli analytics: \(error.localizedDescription)")
        }
    }

    private func normalizeRange() {
        let normalized = PopulationAnalytics.normalizeAgeRange((minimumAge, maximumAge))
        if minimumAge != normalized.0 { minimumAge = normalized.0 }
        if maximumAge != normalized.1 { maximumAge = normalized.1 }
    }
}

/* @Codex */
@MainActor
final class ClinicalScalesCatalogModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var patients: [HomeBasePatientSummary] = []
    @Published private(set) var visiblePatients: [HomeBasePatientSummary] = []

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private var searchTask: Task<Void, Never>?

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?) {
        self.connectionProvider = connectionProvider
    }

    deinit { searchTask?.cancel() }

    func load() async {
        guard let connection = connectionProvider() else {
            state = .unavailable("Collega l'home-base prima di selezionare un paziente.")
            return
        }
        state = .loading
        do {
            patients = try await connection.dataSource.fetchPatients(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId,
                includeDeleted: false
            ).filter { $0.isArchived != true && $0.deletedAt == nil }
            visiblePatients = patients
            state = .loaded
        } catch {
            state = .failed("Impossibile caricare i pazienti: \(error.localizedDescription)")
        }
    }

    func search(_ query: String) {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, let self else { return }
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            visiblePatients = trimmed.isEmpty ? patients : patients.filter {
                "\($0.firstName) \($0.lastName) \($0.taxCode)".lowercased().contains(trimmed)
            }
        }
    }

    var groups: [(area: String, scales: [ClinicalScaleDefinition])] {
        ClinicalScales.all.reduce(into: []) { result, scale in
            let area = PairedScalesSection.area(for: scale.id)
            if let index = result.firstIndex(where: { $0.area == area }) {
                result[index].scales.append(scale)
            } else {
                result.append((area, [scale]))
            }
        }
    }
}

/* @Codex */
struct ClinicalCapabilityGateView: View {
    let store: ClinicalWorkspaceCapabilitiesStore
    let capability: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.slash")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: 440, maxHeight: .infinity)
        .padding(24)
    }

    private var message: String {
        if let message = store.unavailableMessage(for: capability) { return message }
        switch store.state {
        case .failed(let message), .unavailable(let message): return message
        case .loading: return "Verifica delle capability dell'host in corso."
        case .idle: return "Collega l'home-base per verificare le capability disponibili."
        case .loaded: return "L'host collegato non espone la capability \(capability). Aggiorna MediFlow sull'host."
        }
    }
}

/* @Codex */
struct AgendaWorkspaceView: View {
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var model: AgendaWorkspaceModel

    init(capabilities: ClinicalWorkspaceCapabilitiesStore, workspaceModel: PairedPatientsWorkspaceModel) {
        self.capabilities = capabilities
        self.workspaceModel = workspaceModel
        _model = StateObject(wrappedValue: AgendaWorkspaceModel(connectionProvider: { workspaceModel.clinicalWorkspaceConnection }))
    }

    var body: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-agenda") {
                content
            } else {
                ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-agenda")
            }
        }
        .task(id: workspaceModel.connectionState) {
            guard capabilities.hasCapability("network.replica.readonly-agenda") else { return }
            await model.load()
        }
    }

    private var content: some View {
        List {
            // Counts are stated only once a read has happened. Before that they
            // are all zero, and three zeros presented as figures are a claim
            // about the archive rather than an admission that it was not read.
            if model.state == .loaded {
                Section {
                    HStack {
                        agendaStatistic("Visite oggi", value: model.todayCount)
                        agendaStatistic("Pianificate", value: model.plannedCount)
                        agendaStatistic("Pazienti attivi", value: model.activePatientCount)
                    }
                }
            }
            Section("Prossime visite") {
                switch sectionContent {
                case .progress:
                    ProgressView()
                case .message(let message):
                    Text(message).foregroundStyle(.secondary)
                case .rows:
                    ForEach(model.rows) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(row.patientName).chartRowTitle()
                                Text(row.checkup.date, format: .dateTime.day().month().hour().minute())
                                    .chartMetadata()
                            }
                            Spacer()
                            Text(row.presentation.label).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 4)
                                .foregroundStyle(pillColor(row.presentation.pill)).background(pillColor(row.presentation.pill).opacity(0.14), in: Capsule())
                        }
                    }
                }
            }
        }
        .navigationTitle("Agenda")
        .toolbar { Button("Aggiorna", systemImage: "arrow.clockwise") { Task { await model.load() } } }
    }

    var sectionContent: ClinicalWorkspaceSectionContent {
        ClinicalWorkspaceSectionContent(
            state: model.state,
            isEmpty: model.rows.isEmpty,
            idleMessage: "Agenda non ancora letta.",
            emptyMessage: "Nessuna visita pianificata."
        )
    }

    private func agendaStatistic(_ title: String, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) { Text("\(value)").font(.title3.weight(.semibold)); Text(title).chartMetadata() }
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func pillColor(_ pill: AgendaPill) -> Color {
        switch pill { case .coral: .red; case .yellow: .orange; case .blue: .blue; case .green: .green; case .muted: .secondary }
    }
}

/* @Codex */
struct GlobalDiaryWorkspaceView: View {
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var model: GlobalDiaryWorkspaceModel

    init(capabilities: ClinicalWorkspaceCapabilitiesStore, workspaceModel: PairedPatientsWorkspaceModel) {
        self.capabilities = capabilities
        self.workspaceModel = workspaceModel
        _model = StateObject(wrappedValue: GlobalDiaryWorkspaceModel(connectionProvider: { workspaceModel.clinicalWorkspaceConnection }))
    }

    var body: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-clinical-diary-global") { content }
            else { ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-clinical-diary-global") }
        }
        .task(id: workspaceModel.connectionState) {
            guard capabilities.hasCapability("network.replica.readonly-clinical-diary-global") else { return }
            await model.load()
        }
    }

    var sectionContent: ClinicalWorkspaceSectionContent {
        ClinicalWorkspaceSectionContent(
            state: model.state,
            isEmpty: model.rows.isEmpty,
            idleMessage: "Diario non ancora letto.",
            emptyMessage: "Nessuna voce di diario."
        )
    }

    private var content: some View {
        List {
            // "0 voci attive, 0 pazienti" was printed whatever the state, so an
            // unread archive announced itself as an empty one.
            if model.state == .loaded {
                Section { Text("\(model.activeCount) voci attive, \(model.patientCount) pazienti").foregroundStyle(.secondary) }
            }
            Section("Voci recenti") {
                switch sectionContent {
                case .progress:
                    ProgressView()
                case .message(let message):
                    Text(message).foregroundStyle(.secondary)
                case .rows:
                    ForEach(model.rows) { row in
                        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing / 2) {
                            HStack {
                                // Same language the per-patient diary already
                                // uses, for the same reason: a sealed note and a
                                // note nobody wrote must not look alike.
                                if row.lockedFields.contains(.title) {
                                    Label("Titolo non leggibile", systemImage: "lock").chartRowTitle().foregroundStyle(.secondary)
                                } else {
                                    Text(row.item.title).chartRowTitle()
                                }
                                Spacer()
                                if row.item.deleted { Text("Eliminata").chartMetadata().fontWeight(.semibold) }
                            }
                            Text("\(row.item.patientName) · \(row.item.patientCode)").chartMetadata()
                            Text("\(row.type) · \(row.date, format: .dateTime.day().month().hour().minute())").chartMetadata()
                            if row.lockedFields.contains(.content) {
                                Text("Contenuto cifrato non leggibile con la chiave di questa sessione. La voce esiste sull'home-base.")
                                    .chartMetadata()
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("global-diary-content-locked-\(row.id)")
                            } else {
                                Text(row.item.preview).chartProse()
                            }
                            if row.attachmentCount > 0 { Label("\(row.attachmentCount) allegati", systemImage: "paperclip").chartMetadata() }
                        }
                        .padding(.vertical, ClinicalChartMetrics.itemSpacing / 2)
                    }
                }
            }
        }
        .navigationTitle("Diario")
        .toolbar { Button("Aggiorna", systemImage: "arrow.clockwise") { Task { await model.load() } } }
    }
}

/* @Codex */
struct PopulationAnalyticsWorkspaceView: View {
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var model: PopulationAnalyticsWorkspaceModel

    init(capabilities: ClinicalWorkspaceCapabilitiesStore, workspaceModel: PairedPatientsWorkspaceModel) {
        self.capabilities = capabilities
        self.workspaceModel = workspaceModel
        _model = StateObject(wrappedValue: PopulationAnalyticsWorkspaceModel(connectionProvider: { workspaceModel.clinicalWorkspaceConnection }))
    }

    var body: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-patients") { content }
            else { ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-patients") }
        }
        .task(id: workspaceModel.connectionState) {
            guard capabilities.hasCapability("network.replica.readonly-patients") else { return }
            await model.load()
        }
    }

    private var content: some View {
        List {
            Section("Età") {
                Stepper("Da \(model.minimumAge) anni", value: $model.minimumAge, in: 0...120)
                Stepper("A \(model.maximumAge) anni", value: $model.maximumAge, in: 0...120)
                Button("Applica intervallo") { Task { await model.load() } }
            }
            if let statistics = model.statistics {
                // Two counts and two percentages, not four percentages.
                //
                // "Pazienti" was `percent(totalInRange, total: totalInRange)`,
                // which is 100 by construction — a tile that could only ever
                // read 100%. And "Senza nascita" is a share of the whole cohort,
                // because a patient with no birth date is excluded from the age
                // range entirely: its base is genuinely not the base of the two
                // beside it. Percentages side by side are read as comparable, so
                // the two that do not share a base are stated as counts, and the
                // base of the two that do is written under them.
                Section {
                    HStack {
                        count("Pazienti in fascia", statistics.totalInRange)
                        metric("ADI", statistics.adiCount, statistics.totalInRange)
                        metric("Con diagnosi", statistics.withDiagnoses, statistics.totalInRange)
                        count("Senza data di nascita", statistics.withoutBirthDate)
                    }
                } footer: {
                    Text("Le percentuali sono sui \(statistics.totalInRange) pazienti in fascia. Chi non ha una data di nascita resta fuori dalla fascia e non entra in quel conteggio.")
                }
                Section("Distribuzione per età") { ForEach(PopulationAgeBucket.allCases, id: \.self) { bucket in distributionRow(bucket.rawValue, value: statistics.ageDistribution[bucket, default: 0], total: statistics.totalInRange) } }
                Section("Diagnosi più frequenti") {
                    if statistics.topDiagnoses.isEmpty { Text("Nessuna diagnosi disponibile.").foregroundStyle(.secondary) }
                    ForEach(Array(statistics.topDiagnoses.enumerated()), id: \.element.key) { _, diagnosis in HStack { VStack(alignment: .leading) { Text(diagnosis.description).chartRowTitle(); ClinicalCodePill(diagnosis.code) }; Spacer(); Text("\(diagnosis.count)").font(.headline) } }
                }
            } else {
                // Previously only `.loading` and `.failed` were handled, so with
                // no connection the view rendered nothing at all: a screen with
                // the age steppers and nothing under them, saying neither what
                // the numbers are nor why they are missing.
                switch sectionContent {
                case .progress:
                    Section { ProgressView() }
                case .message(let message):
                    Section { Text(message).foregroundStyle(.secondary) }
                case .rows:
                    EmptyView()
                }
            }
        }
        .navigationTitle("Analytics")
        .toolbar { Button("Aggiorna", systemImage: "arrow.clockwise") { Task { await model.load() } } }
    }

    var sectionContent: ClinicalWorkspaceSectionContent {
        ClinicalWorkspaceSectionContent(
            state: model.state,
            isEmpty: model.statistics == nil,
            idleMessage: "Statistiche non ancora calcolate.",
            emptyMessage: "Nessun paziente nell'intervallo di età scelto."
        )
    }

    private func metric(_ label: String, _ value: Int, _ total: Int) -> some View { tile(label, "\(PopulationAnalytics.percent(value, total: total))%") }

    /// A plain number, for the quantities whose base is not the base of the
    /// percentages next to them.
    private func count(_ label: String, _ value: Int) -> some View { tile(label, "\(value)") }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing / 2) {
            Text(value).font(.title3.weight(.semibold))
            Text(label).chartMetadata()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func distributionRow(_ label: String, value: Int, total: Int) -> some View { VStack(alignment: .leading, spacing: 4) { HStack { Text(label); Spacer(); Text("\(value)").foregroundStyle(.secondary) }; ProgressView(value: Double(value), total: Double(max(total, 1))) } }
}

/* @Codex */
struct ClinicalScalesWorkspaceView: View {
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var model: ClinicalScalesCatalogModel
    @State private var query = ""
    @State private var pendingScale: ClinicalScaleDefinition?
    @State private var selectedScale: ClinicalScaleDefinition?
    @State private var showsPatientPicker = false

    init(capabilities: ClinicalWorkspaceCapabilitiesStore, workspaceModel: PairedPatientsWorkspaceModel) {
        self.capabilities = capabilities
        self.workspaceModel = workspaceModel
        _model = StateObject(wrappedValue: ClinicalScalesCatalogModel(connectionProvider: { workspaceModel.clinicalWorkspaceConnection }))
    }

    var body: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-patients") { catalog }
            else { ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-patients") }
        }
        .task(id: workspaceModel.connectionState) {
            guard capabilities.hasCapability("network.replica.readonly-patients") else { return }
            await model.load()
        }
        .sheet(isPresented: $showsPatientPicker) { patientPicker }
        .sheet(item: $selectedScale) { scale in scaleForm(scale) }
    }

    private var catalog: some View {
        List {
            ForEach(model.groups, id: \.area) { group in
                Section(group.area) {
                    ForEach(group.scales) { scale in
                        Button { pendingScale = scale; showsPatientPicker = true } label: { VStack(alignment: .leading, spacing: 3) { Text(scale.title); Text(scale.scaleDescription).font(.caption).foregroundStyle(.secondary) } }
                    }
                }
            }
        }
        .navigationTitle("Scale")
    }

    private var patientPicker: some View {
        NavigationStack {
            List(model.visiblePatients) { patient in
                /* @Codex */
                Button { Task { await open(patient) } } label: {
                    VStack(alignment: .leading) {
                        Text("\(patient.firstName) \(patient.lastName)")
                        Text(PairedPatientsWorkspaceSupport.compactTaxCode(patient.taxCode))
                            .font(.caption)
                            .registro()
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .searchable(text: $query, prompt: "Cerca paziente")
            .onChange(of: query) { model.search($0) }
            .navigationTitle("Seleziona paziente")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annulla") { showsPatientPicker = false } } }
        }
    }

    private func scaleForm(_ scale: ClinicalScaleDefinition) -> some View {
        ClinicalScaleFormView(definition: scale, onSubmit: { answers in
            Task { await workspaceModel.submitScale(scale, answers: answers) }
            selectedScale = nil
        }, onCancel: { selectedScale = nil })
    }

    private func open(_ patient: HomeBasePatientSummary) async {
        showsPatientPicker = false
        await workspaceModel.loadPatient(patient)
        selectedScale = pendingScale
        pendingScale = nil
    }
}
