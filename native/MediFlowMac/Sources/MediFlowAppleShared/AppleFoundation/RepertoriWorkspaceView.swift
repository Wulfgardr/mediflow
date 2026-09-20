#if os(macOS)
// @Codex: WUL-673. Consultation only; canonical paired WHO, no patient autoapply.
import SwiftUI

@MainActor
final class RepertoriStore: ObservableObject {
    enum Catalogue: String, CaseIterable, Identifiable {
        case drugs, exemptions, terminology
        var id: String { rawValue }
        var title: String {
            switch self {
            case .drugs: "Farmaci"
            case .exemptions: "Esenzioni"
            case .terminology: "ICD-11 WHO"
            }
        }
        var prompt: String {
            switch self {
            case .drugs: "Nome commerciale, principio attivo o AIC"
            case .exemptions: "Codice o descrizione dell’esenzione"
            case .terminology: "Termini ICD-11 in inglese — premi Cerca"
            }
        }
    }
    enum Operation { case search, checkCode, readiness }

    @Published var catalogue: Catalogue = .drugs { didSet { if catalogue != oldValue { invalidate() } } }
    @Published var query = "" { didSet { if query != oldValue { invalidate() } } }
    @Published var code = "" { didSet { if code != oldValue { invalidate() } } }
    @Published private(set) var drugs: [HomeBaseDrugSummary] = []
    @Published private(set) var exemptions: [HomeBaseExemptionSummary] = []
    @Published private(set) var whoSearch: HomeBaseWHOSearchResponse?
    @Published private(set) var whoCheck: HomeBaseWHOCodeCheckResponse?
    @Published private(set) var whoReadiness: HomeBaseWHOReadiness?
    @Published private(set) var isSearching = false
    @Published private(set) var failure: String?
    @Published private(set) var hasSearched = false
    @Published private(set) var wasCancelled = false

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private var pending: Task<Void, Never>?
    private var fence = RepertoriRequestFence<ClinicalWorkspaceConnection.Identity>()
    private var lastOperation: Operation = .search
    // Read-only completion handle for owner/tests; it cannot start or retry work.
    var pendingCompletion: Task<Void, Never>? { pending }

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?) {
        self.connectionProvider = connectionProvider
    }

    private func clearResults() {
        drugs = []; exemptions = []
        whoSearch = nil; whoCheck = nil; whoReadiness = nil
        failure = nil; hasSearched = false
    }
    private func invalidate() {
        fence.invalidate(); pending?.cancel(); pending = nil
        isSearching = false; wasCancelled = false
        clearResults()
    }
    func connectionChanged() { invalidate() }
    func close() { invalidate() }
    func cancel() { invalidate(); wasCancelled = true }

    var canSearch: Bool {
        if catalogue == .terminology { return (try? HomeBaseWHODecoder.normalizedQuery(query)) != nil }
        return query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }
    var canCheckCode: Bool {
        HomeBaseWHODecoder.isCheckCode(code.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // Drugs/exemptions retain their existing debounce; WHO requires explicit intent.
    func scheduleSearch() {
        guard catalogue != .terminology, canSearch else { return }
        start(.search, debounce: true)
    }
    func submitSearch() { guard canSearch else { return }; start(.search) }
    func submitCodeCheck() { guard catalogue == .terminology, canCheckCode else { return }; start(.checkCode) }
    func inspectService() { guard catalogue == .terminology else { return }; start(.readiness) }
    func retry() {
        switch lastOperation {
        case .search: submitSearch()
        case .checkCode: submitCodeCheck()
        case .readiness: inspectService()
        }
    }
    func check(_ entry: HomeBaseWHOEntry) {
        code = entry.code
        submitCodeCheck()
    }

    private func start(_ operation: Operation, debounce: Bool = false) {
        invalidate()
        lastOperation = operation
        guard let connection = connectionProvider() else {
            failure = "Collega l’home-base per consultare i repertori."
            return
        }
        // No master key is retained by an outstanding reference-data lookup.
        let request = connection.readRequest
        let selectedCatalogue = catalogue
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let checkedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let ticket = fence.begin(identity: request.identity)
        isSearching = true
        pending = Task { [weak self] in
            if debounce {
                do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
            }
            guard let self, self.current(ticket, request: request) else { return }
            defer {
                // An obsolete task must not clear another task's spinner or state.
                if self.current(ticket, request: request) {
                    self.isSearching = false; self.hasSearched = true; self.pending = nil
                }
            }
            do {
                switch selectedCatalogue {
                case .drugs:
                    let rows = try await request.dataSource.searchDrugs(query: term,
                        limit: HomeBaseCatalogSearchLimit.defaultMaximum, credentials: request.credentials,
                        sessionCookie: request.sessionCookie, ambulatoryId: request.ambulatoryId)
                    guard self.current(ticket, request: request) else { return }
                    self.drugs = rows
                case .exemptions:
                    let rows = try await request.dataSource.searchExemptions(query: term,
                        limit: HomeBaseCatalogSearchLimit.defaultMaximum, credentials: request.credentials,
                        sessionCookie: request.sessionCookie, ambulatoryId: request.ambulatoryId)
                    guard self.current(ticket, request: request) else { return }
                    self.exemptions = rows
                case .terminology:
                    switch operation {
                    case .search:
                        let result = try await request.dataSource.searchWHO(query: term, credentials: request.credentials,
                            sessionCookie: request.sessionCookie, ambulatoryId: request.ambulatoryId)
                        guard self.current(ticket, request: request) else { return }
                        self.whoSearch = result
                    case .checkCode:
                        let result = try await request.dataSource.checkWHOCode(code: checkedCode, credentials: request.credentials,
                            sessionCookie: request.sessionCookie, ambulatoryId: request.ambulatoryId)
                        guard self.current(ticket, request: request) else { return }
                        self.whoCheck = result
                    case .readiness:
                        let result = try await request.dataSource.readWHOReadiness(credentials: request.credentials,
                            sessionCookie: request.sessionCookie, ambulatoryId: request.ambulatoryId)
                        guard self.current(ticket, request: request) else { return }
                        self.whoReadiness = result
                    }
                }
            } catch {
                guard self.current(ticket, request: request) else { return }
                if error is CancellationError { self.wasCancelled = true }
                else { self.failure = error.localizedDescription }
            }
        }
    }
    private func current(_ ticket: RepertoriRequestFence<ClinicalWorkspaceConnection.Identity>.Ticket,
                         request: ClinicalWorkspaceReadRequest) -> Bool {
        !Task.isCancelled && fence.isCurrent(ticket, identity: connectionProvider()?.identity)
            && request.current(using: connectionProvider) != nil
    }
    var resultCount: Int {
        switch catalogue {
        case .drugs: drugs.count
        case .exemptions: exemptions.count
        case .terminology: whoSearch?.entries.count ?? (whoCheck?.status == .found ? 1 : 0)
        }
    }
}

struct RepertoriWorkspaceView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var store: RepertoriStore

    init(workspaceModel: PairedPatientsWorkspaceModel) {
        self.workspaceModel = workspaceModel
        _store = StateObject(wrappedValue: RepertoriStore(connectionProvider: { [weak workspaceModel] in
            workspaceModel?.clinicalWorkspaceConnection
        }))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            picker
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 10)
            if store.catalogue == .terminology { whoControls.padding(.horizontal, 20).padding(.bottom, 10) }
            Divider()
            results.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .searchable(text: $store.query, placement: .toolbar, prompt: store.catalogue.prompt)
        .onSubmit(of: .search) { store.submitSearch() }
        .onChange(of: store.query) { _ in store.scheduleSearch() }
        .onChange(of: store.catalogue) { _ in store.scheduleSearch() }
        .onChange(of: workspaceModel.clinicalWorkspaceConnection?.identity) { _ in store.connectionChanged() }
        .onDisappear { store.close() }
        .accessibilityIdentifier("clinical-workspace-repertori-view")
    }

    private var picker: some View {
        Picker("Repertorio", selection: $store.catalogue) {
            ForEach(RepertoriStore.Catalogue.allCases) { item in Text(item.title).tag(item) }
        }
        .pickerStyle(.segmented).labelsHidden()
        .accessibilityIdentifier("repertori-catalogue-picker")
    }
    private var whoControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ICD-11 WHO · 2026-01 · Inglese (en) · sola consultazione")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cerca") { store.submitSearch() }
                    .disabled(!store.canSearch || store.isSearching)
                    .accessibilityIdentifier("repertori-who-search")
                TextField("Codice ICD-11", text: $store.code)
                    .textFieldStyle(.roundedBorder).frame(maxWidth: 220)
                    .onSubmit { store.submitCodeCheck() }
                    .accessibilityIdentifier("repertori-who-code")
                Button("Controlla codice") { store.submitCodeCheck() }
                    .disabled(!store.canCheckCode || store.isSearching)
                    .accessibilityIdentifier("repertori-who-check")
                Spacer()
                Button("Verifica servizio") { store.inspectService() }
                    .disabled(store.isSearching)
                    .accessibilityIdentifier("repertori-who-readiness")
            }
            Text("Il controllo verifica l’esistenza del codice nella release, non la diagnosi. Non modifica la cartella. Inserisci solo termini, senza dati del paziente.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var results: some View {
        if let failure = store.failure {
            VStack {
                placeholder(systemImage: "exclamationmark.triangle", title: "Consultazione non riuscita", detail: failure)
                HStack {
                    Button("Riprova") { store.retry() }.accessibilityIdentifier("repertori-retry")
                    if store.catalogue == .terminology { Button("Verifica servizio") { store.inspectService() } }
                }.padding(.bottom, 20)
            }
        } else if store.isSearching {
            VStack(spacing: 12) {
                ProgressView()
                Button("Annulla") { store.cancel() }.accessibilityIdentifier("repertori-cancel")
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.wasCancelled {
            placeholder(systemImage: "xmark.circle", title: "Consultazione annullata", detail: "Nessun risultato tardivo verrà mostrato. Avvia una nuova consultazione quando necessario.")
        } else if store.catalogue == .terminology {
            whoResults
        } else if !store.canSearch {
            placeholder(systemImage: "magnifyingglass", title: "Cerca nel repertorio", detail: "Digita almeno due caratteri. \(store.catalogue.prompt).")
        } else if store.hasSearched, store.resultCount == 0 {
            placeholder(systemImage: "tray", title: "Nessun risultato", detail: "Nessuna voce corrisponde alla ricerca. Se il repertorio non è mai stato importato sull’host, l’elenco è vuoto per qualunque termine.")
        } else { list }
    }

    @ViewBuilder
    private var whoResults: some View {
        if let response = store.whoSearch {
            VStack(alignment: .leading, spacing: 8) {
                searchProvenance(response).padding([.horizontal, .top], 16)
                if response.partial {
                    Text("Risultati parziali: restringi la ricerca per ottenere una selezione più mirata.")
                        .font(.callout).padding(.horizontal, 16)
                        .accessibilityIdentifier("repertori-who-partial")
                }
                if response.entries.isEmpty {
                    placeholder(systemImage: "tray", title: "Nessun risultato WHO", detail: response.partial
                        ? "Nessuna voce in questa risposta parziale. Restringi la ricerca; non è una prova di assenza nel dataset."
                        : "Nessuna voce corrisponde ai termini cercati nella risposta WHO. Prova termini inglesi differenti.")
                } else {
                    List(response.entries) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(entry.code).font(.body.weight(.medium)).registro()
                                Spacer()
                                Button("Controlla codice") { store.check(entry) }
                            }
                            Text(entry.description).fixedSize(horizontal: false, vertical: true)
                            Text(entry.canonicalUri).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        }.padding(.vertical, 3)
                    }.accessibilityIdentifier("repertori-who-results")
                }
            }
        } else if let response = store.whoCheck {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(response.status == .found ? "Codice presente nella release" : "Codice non trovato nella release").font(.headline)
                    Text(response.code).registro().textSelection(.enabled)
                    if let entry = response.entry {
                        Text(entry.stemTitle)
                        Text("Codice radice: \(entry.stemCode)").font(.caption)
                        Text(entry.canonicalUri).font(.caption).textSelection(.enabled)
                        Text(entry.stemUri).font(.caption).textSelection(.enabled)
                    }
                    Text("Controllo live · \(response.receipt.checkedAt)").font(.caption)
                    provenance(release: response.receipt.releaseId, language: response.receipt.language,
                        binding: response.receipt.bindingId, image: response.receipt.imageDigest, dataset: response.receipt.datasetSnapshotId)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }.accessibilityIdentifier("repertori-who-code-result")
        } else if let readiness = store.whoReadiness {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(readinessTitle(readiness.status)).font(.headline)
                    Text(readinessDetail(readiness.status))
                    if let date = readiness.lastLiveObservedAt { Text("Ultima risposta live osservata: \(date)").font(.caption) }
                    if let source = readiness.lastResultSource { Text("Fonte dell’ultimo risultato: \(source == .live ? "live" : "cache, non nuova prova live")").font(.caption) }
                    provenance(release: readiness.releaseId, language: readiness.language, binding: readiness.bindingId,
                        image: readiness.imageDigest, dataset: readiness.datasetSnapshotId)
                    Button("Rileggi stato") { store.inspectService() }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }.accessibilityIdentifier("repertori-who-service-state")
        } else {
            placeholder(systemImage: "magnifyingglass", title: "Consulta ICD-11 WHO",
                detail: "Inserisci termini inglesi nella ricerca e premi Cerca, oppure inserisci un codice e premi Controlla codice. La digitazione non avvia richieste WHO.")
        }
    }
    private func searchProvenance(_ response: HomeBaseWHOSearchResponse) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(response.receipt.source == .live ? "Fonte: servizio WHO locale · live" : "Fonte: cache WHO locale · non è una nuova risposta live").font(.callout)
            Text("Acquisito: \(response.receipt.fetchedAt) · Scadenza: \(response.receipt.expiresAt)").font(.caption)
            provenance(release: response.receipt.releaseId, language: response.receipt.language,
                binding: response.receipt.bindingId, image: response.receipt.imageDigest, dataset: response.receipt.datasetSnapshotId)
        }
    }
    private func provenance(release: String, language: String, binding: String, image: String?, dataset: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(HomeBaseWHODecoder.attribution) · \(release) · \(language)").font(.caption)
            DisclosureGroup("Provenienza e binding") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Binding: \(binding)")
                    Text("Immagine: \(image ?? "non configurata")")
                    Text("Dataset: \(dataset ?? "non configurato")")
                }.font(.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.font(.caption)
        }.foregroundStyle(.secondary)
    }
    private func readinessTitle(_ status: HomeBaseWHOReadinessStatus) -> String {
        switch status {
        case .disabled: "WHO disabilitato sull’host"
        case .configurationRequired: "Configurazione WHO richiesta"
        case .configured: "WHO configurato, disponibilità non verificata"
        case .available: "WHO disponibile secondo l’ultima osservazione"
        case .unavailable: "Servizio WHO non disponibile"
        }
    }
    private func readinessDetail(_ status: HomeBaseWHOReadinessStatus) -> String {
        switch status {
        case .disabled, .configurationRequired:
            "Chiedi al responsabile dell’home-base di verificare il setup WHO locale documentato. Questa app non installa o avvia servizi."
        case .configured:
            "La configurazione non prova che WHO risponda. Esegui una ricerca specifica o un controllo codice; se fallisce, verifica il servizio sull’host."
        case .available:
            "Stato osservato dal backend, non un nuovo test live. Una risposta dalla cache è indicata separatamente."
        case .unavailable:
            "Verifica il servizio sull’home-base. Per una ricerca puoi anche restringere i termini. Lo stato non identifica da solo la causa dell’errore."
        }
    }

    @ViewBuilder
    private var list: some View {
        switch store.catalogue {
        case .drugs:
            List(store.drugs) { drug in
                VStack(alignment: .leading, spacing: 3) {
                    Text(drug.name)
                        .font(.body.weight(.medium))
                    HStack(spacing: 6) {
                        Text(drug.aic).registro()
                        if let atc = drug.atc { Text("· ATC \(atc)").registro() }
                        if let principle = drug.activePrinciple { Text("· \(principle)") }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let packaging = drug.packaging {
                        Text(packaging)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("repertori-drugs-list")

        case .exemptions:
            List(store.exemptions) { exemption in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(exemption.code)
                            .font(.body.weight(.medium))
                            .registro()
                        exemptionTags(exemption)
                    }
                    Text(exemption.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("repertori-exemptions-list")

        case .terminology:
            EmptyView() // @Codex: WHO has its own typed, provenance-preserving surface above.
        }
    }

    @ViewBuilder
    private func exemptionTags(_ exemption: HomeBaseExemptionSummary) -> some View {
        if exemption.isPharma == true { PairedPatientFlagChip("Farmaci", tone: .info) }
        if exemption.isSpecialist == true { PairedPatientFlagChip("Specialistica", tone: .info) }
        if exemption.isNational == true { PairedPatientFlagChip("Nazionale", tone: .neutral) }
    }

    private func placeholder(systemImage: String, title: String, detail: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
