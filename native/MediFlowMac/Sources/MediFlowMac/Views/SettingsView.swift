// Codex: created 2026-02-01
import SwiftUI
import UniformTypeIdentifiers

/* @Codex */
struct SettingsView: View {
    @ObservedObject var settings: SettingsStore
    @State private var selection: SettingsPane = .app

    var body: some View {
        NavigationSplitView {
            List(SettingsPane.allCases, selection: $selection) { pane in
                Label(pane.title, systemImage: pane.systemImage)
                    .tag(pane)
            }
            .listStyle(.sidebar)
            .navigationTitle("Impostazioni")
        } detail: {
            SettingsDetailView(selection: selection, settings: settings)
        }
        .frame(minWidth: 900, minHeight: 620)
    }
}

/* @Codex */
private enum SettingsPane: String, CaseIterable, Identifiable {
    case app
    case ai
    case tools
    case catalogs
    case diagnostics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .app: return "App"
        case .ai: return "AI Stack"
        case .tools: return "Strumenti"
        case .catalogs: return "Cataloghi"
        case .diagnostics: return "Diagnostica"
        }
    }

    var systemImage: String {
        switch self {
        case .app: return "gearshape"
        case .ai: return "brain"
        case .tools: return "hammer"
        case .catalogs: return "tray.full"
        case .diagnostics: return "waveform.path.ecg"
        }
    }
}

/* @Codex */
private struct SettingsDetailView: View {
    let selection: SettingsPane
    @ObservedObject var settings: SettingsStore

    var body: some View {
        switch selection {
        case .app:
            AppSettingsPane(settings: settings)
        case .ai:
            AISettingsPane()
        case .tools:
            ToolsSettingsPane()
        case .catalogs:
            CatalogsSettingsPane()
        case .diagnostics:
            DiagnosticsSettingsPane(settings: settings)
        }
    }
}

/* @Codex */
private struct AppSettingsPane: View {
    @ObservedObject var settings: SettingsStore
    @State private var isTesting = false
    @State private var testMessage: String?
    @State private var testSuccess: Bool?
    @State private var showConnection = true
    @State private var showSecurity = true
    @State private var showActions = true
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SettingsHeader(title: "Configurazione App", subtitle: "Connessione locale, sicurezza e utilita")

                SettingsGlassSection(title: "API Locale", subtitle: "Base URL e token di accesso", isExpanded: $showConnection) {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Base URL", text: $settings.baseURLString)
                            .textFieldStyle(.roundedBorder)
                        SecureField("Token API", text: $settings.token)
                            .textFieldStyle(.roundedBorder)

                        HStack {
                            Button("Salva") {
                                settings.save()
                            }
                            Button(isTesting ? "Test in corso..." : "Test connessione") {
                                Task { await runTest() }
                            }
                            .disabled(isTesting)
                            Button("Carica token da Portachiavi") {
                                settings.refreshTokenFromKeychain()
                            }
                            Button("Cancella token") {
                                settings.clearToken()
                            }
                            .foregroundStyle(.red)
                        }

                        if let message = settings.errorMessage {
                            Text(message)
                                .foregroundStyle(.red)
                                .font(.caption)
                        }
                        if let message = testMessage {
                            Text(message)
                                .foregroundStyle(testSuccess == true ? .green : .red)
                                .font(.caption)
                        }
                    }
                }

                SettingsGlassSection(title: "TLS", subtitle: "Fingerprint SHA256 per pinning", isExpanded: $showSecurity) {
                    TextField("Fingerprint SHA256 (hex)", text: $settings.tlsPin)
                        .textFieldStyle(.roundedBorder)
                }

                SettingsGlassSection(title: "Azioni rapide", subtitle: "Collegamenti utili", isExpanded: $showActions) {
                    HStack {
                        Button("Apri app web") {
                            if let url = URL(string: "http://localhost:3000") {
                                openURL(url)
                            }
                        }
                        Spacer()
                    }
                }
            }
            .padding(24)
        }
    }

    @MainActor
    private func runTest() async {
        if isTesting { return }
        testMessage = nil
        testSuccess = nil

        guard settings.save() else {
            testMessage = settings.errorMessage ?? "Impostazioni non valide."
            testSuccess = false
            return
        }

        isTesting = true
        defer { isTesting = false }

        do {
            try await LocalAPIClient.shared.testConnection()
            testMessage = "Connessione OK."
            testSuccess = true
        } catch {
            if let localError = error as? LocalAPIError {
                testMessage = localError.localizedDescription
            } else {
                testMessage = "Connessione fallita."
            }
            testSuccess = false
        }
    }
}

/* @Codex */
private struct AISettingsPane: View {
    @State private var showStack = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SettingsHeader(title: "Stack AI", subtitle: "Configurazione modelli e diagnostica")

                SettingsGlassSection(title: "Controllo Stack AI", subtitle: "Provider, modelli e stato", isExpanded: $showStack) {
                    AIControlPanelView(embedded: true)
                }
            }
            .padding(24)
        }
    }
}

/* @Codex */
private struct ToolsSettingsPane: View {
    @State private var showAIChat = true
    @State private var showDrugs = false
    @State private var showICD = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SettingsHeader(title: "Strumenti", subtitle: "Funzioni operative integrate")

                SettingsGlassSection(title: "AI Chat", subtitle: "Playground controllato", isExpanded: $showAIChat) {
                    AIToolView()
                }

                SettingsGlassSection(title: "Farmaci", subtitle: "Ricerca nel database farmaci", isExpanded: $showDrugs) {
                    DrugsToolView()
                }

                SettingsGlassSection(title: "ICD-11", subtitle: "Diagnosi e codifiche", isExpanded: $showICD) {
                    ICDToolView()
                }
            }
            .padding(24)
        }
    }
}

/* @Codex */
private struct CatalogsSettingsPane: View {
    @State private var states: [CatalogKind: CatalogOperationState] = [
        .drugs: .idle,
        .exemptions: .idle
    ]
    @State private var counts: [CatalogKind: Int] = [:]
    @State private var isImporting = false
    @State private var importTarget: CatalogKind?
    @State private var clearTarget: CatalogKind?
    @State private var showDrugs = true
    @State private var showExemptions = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SettingsHeader(title: "Cataloghi", subtitle: "Farmaci ed esenzioni condivisi con il backend locale")

                catalogSection(
                    kind: .drugs,
                    subtitle: "Dataset AIFA usato da ricerca e terapie",
                    isExpanded: $showDrugs
                )

                catalogSection(
                    kind: .exemptions,
                    subtitle: "Codici esenzione usati da anagrafica e mapping paziente",
                    isExpanded: $showExemptions
                )
            }
            .padding(24)
        }
        .task {
            await refreshAll()
        }
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            handleImportSelection(result)
        }
        .alert(
            "Svuotare il catalogo?",
            isPresented: Binding(
                get: { clearTarget != nil },
                set: { if !$0 { clearTarget = nil } }
            )
        ) {
            Button("Svuota", role: .destructive) {
                guard let target = clearTarget else { return }
                Task { await clear(target) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            if let target = clearTarget {
                Text("Il catalogo \(target.title.lowercased()) sara svuotato. Le ricerche torneranno disponibili dopo una nuova importazione.")
            }
        }
    }

    private func catalogSection(
        kind: CatalogKind,
        subtitle: String,
        isExpanded: Binding<Bool>
    ) -> some View {
        SettingsGlassSection(title: kind.title, subtitle: subtitle, isExpanded: isExpanded) {
            VStack(alignment: .leading, spacing: 12) {
                statusRow(kind: kind)

                HStack(spacing: 10) {
                    Button("Aggiorna stato") {
                        Task { await refresh(kind) }
                    }
                    .disabled(state(for: kind).isRunning)

                    Button("Importa JSON...") {
                        importTarget = kind
                        isImporting = true
                    }
                    .disabled(state(for: kind).isRunning)

                    Button("Svuota catalogo", role: .destructive) {
                        clearTarget = kind
                    }
                    .disabled(state(for: kind).isRunning)

                    Spacer()
                }
            }
        }
    }

    private func statusRow(kind: CatalogKind) -> some View {
        let state = state(for: kind)

        return HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(state.color)
                .frame(width: 10, height: 10)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 3) {
                Text(statusTitle(for: kind, state: state))
                    .font(.caption.weight(.semibold))
                Text(state.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if state.isRunning {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    @MainActor
    private func refreshAll() async {
        await refresh(.drugs)
        await refresh(.exemptions)
    }

    @MainActor
    private func refresh(_ kind: CatalogKind) async {
        states[kind] = .running("Verifica in corso...")

        do {
            let count = try await LocalAPIClient.shared.catalogCount(kind)
            counts[kind] = count
            states[kind] = count == 0
                ? .ok("Nessuna voce caricata.")
                : .ok("\(count.formatted()) voci disponibili.")
        } catch {
            states[kind] = .error(message(for: error, fallback: "Impossibile leggere lo stato catalogo."))
        }
    }

    private func handleImportSelection(_ result: Result<[URL], Error>) {
        guard let target = importTarget else { return }
        importTarget = nil

        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task { await importCatalog(target, from: url) }
        case .failure(let error):
            states[target] = .error(error.localizedDescription)
        }
    }

    @MainActor
    private func importCatalog(_ kind: CatalogKind, from url: URL) async {
        states[kind] = .running("Importazione in corso...")

        do {
            let canAccess = url.startAccessingSecurityScopedResource()
            defer {
                if canAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            let data = try Data(contentsOf: url)
            let imported = try await LocalAPIClient.shared.importCatalog(kind, jsonData: data)
            let count = try await LocalAPIClient.shared.catalogCount(kind)
            counts[kind] = count

            if let imported {
                states[kind] = .ok("\(imported.formatted()) voci importate. Totale: \(count.formatted()).")
            } else {
                states[kind] = .ok("Importazione completata. Totale: \(count.formatted()).")
            }
        } catch {
            states[kind] = .error(message(for: error, fallback: "Importazione interrotta. Verificare lo stato del catalogo."))
        }
    }

    @MainActor
    private func clear(_ kind: CatalogKind) async {
        clearTarget = nil
        states[kind] = .running("Svuotamento in corso...")

        do {
            try await LocalAPIClient.shared.clearCatalog(kind)
            counts[kind] = 0
            states[kind] = .ok("Nessuna voce caricata.")
        } catch {
            states[kind] = .error(message(for: error, fallback: "Impossibile svuotare il catalogo."))
        }
    }

    private func state(for kind: CatalogKind) -> CatalogOperationState {
        states[kind] ?? .idle
    }

    private func statusTitle(for kind: CatalogKind, state: CatalogOperationState) -> String {
        if let count = counts[kind] {
            return "\(kind.title): \(count.formatted()) voci"
        }
        return "\(kind.title): stato non verificato"
    }

    private func message(for error: Error, fallback: String) -> String {
        if let localError = error as? LocalAPIError {
            return localError.localizedDescription
        }
        return fallback
    }
}

/* @Codex */
private enum CatalogOperationState: Equatable {
    case idle
    case running(String)
    case ok(String)
    case error(String)

    var message: String {
        switch self {
        case .idle: return "Non verificato."
        case .running(let message), .ok(let message), .error(let message): return message
        }
    }

    var color: Color {
        switch self {
        case .idle: return .gray
        case .running: return .orange
        case .ok: return .green
        case .error: return .red
        }
    }

    var isRunning: Bool {
        if case .running = self { return true }
        return false
    }
}

/* @Codex */
private struct DiagnosticsSettingsPane: View {
    @ObservedObject var settings: SettingsStore
    @State private var isRunning = false
    @State private var apiStatus: DiagnosticState = .idle
    @State private var icdStatus: DiagnosticState = .idle
    @State private var ocrStatus: DiagnosticState = .idle
    @State private var showDiagnostics = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SettingsHeader(title: "Diagnostica", subtitle: "Monitoraggio infrastruttura locale")

                SettingsGlassSection(title: "Sistema", subtitle: "API locale, ICD e OCR", isExpanded: $showDiagnostics) {
                    VStack(alignment: .leading, spacing: 12) {
                        statusRow(title: "API Locale", state: apiStatus)
                        statusRow(title: "ICD-11", state: icdStatus)
                        statusRow(title: "OCR", state: ocrStatus)

                        HStack {
                            Button(isRunning ? "Diagnostica in corso..." : "Esegui diagnostica") {
                                Task { await runDiagnostics() }
                            }
                            .disabled(isRunning)
                            Spacer()
                        }
                    }
                }
            }
            .padding(24)
        }
    }

    @MainActor
    private func runDiagnostics() async {
        if isRunning { return }
        isRunning = true
        defer { isRunning = false }

        guard settings.save() else {
            apiStatus = .error("Impostazioni non valide")
            icdStatus = .idle
            ocrStatus = .idle
            return
        }

        apiStatus = .running
        do {
            try await LocalAPIClient.shared.testConnection()
            apiStatus = .ok("OK")
        } catch {
            apiStatus = .error("Connessione fallita")
        }

        icdStatus = .running
        do {
            let online = try await LocalAPIClient.shared.checkICDStatus()
            icdStatus = online ? .ok("Online") : .error("Offline")
        } catch {
            icdStatus = .error("Offline")
        }

        ocrStatus = .running
        do {
            let status = try await LocalAPIClient.shared.checkOCRStatus()
            ocrStatus = status.available ? .ok(status.message) : .error(status.message)
        } catch {
            ocrStatus = .error("OCR non disponibile")
        }
    }

    private func statusRow(title: String, state: DiagnosticState) -> some View {
        HStack {
            Circle()
                .fill(state.color)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                Text(state.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

/* @Codex */
private enum DiagnosticState {
    case idle
    case running
    case ok(String)
    case error(String)

    var message: String {
        switch self {
        case .idle: return "Non eseguito"
        case .running: return "In corso"
        case .ok(let message): return message
        case .error(let message): return message
        }
    }

    var color: Color {
        switch self {
        case .idle: return .gray
        case .running: return .orange
        case .ok: return .green
        case .error: return .red
        }
    }
}

/* @Codex */
private struct SettingsHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/* @Codex */
private struct SettingsGlassSection<Content: View>: View {
    let title: String
    let subtitle: String
    @Binding var isExpanded: Bool
    let content: Content

    init(title: String, subtitle: String, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self._isExpanded = isExpanded
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DisclosureGroup(isExpanded: $isExpanded) {
                content
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
    }
}
