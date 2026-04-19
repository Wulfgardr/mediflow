// Codex: created 2026-02-02
import SwiftUI

struct AIControlPanelView: View {
    /* @Codex */
    private static let staleLegacyDefaults: Set<String> = [
        "hf.co/unsloth/medgemma-1.5-4b-it-GGUF",
        "qwen2.5:32b"
    ]
    /* @Codex */
    private let embedded: Bool

    init(embedded: Bool = false) {
        self.embedded = embedded
    }
    enum Provider: String, CaseIterable, Identifiable {
        case ollama
        case mlx
        case apple

        var id: String { rawValue }

        var label: String {
            switch self {
            case .ollama: return "Ollama"
            case .mlx: return "Apple MLX"
            case .apple: return "Apple Intelligence (Sperimentale)"
            }
        }
    }

    enum HardwareProfile: String, CaseIterable, Identifiable {
        case custom
        case low
        case medium
        case high

        var id: String { rawValue }

        var label: String {
            switch self {
            case .custom: return "Personalizzato"
            case .low: return "Light"
            case .medium: return "Balanced"
            case .high: return "Pro"
            }
        }
    }

    struct ModelSuggestion: Identifiable {
        let id = UUID()
        let name: String
        let description: String
    }

    @State private var provider: Provider = .ollama
    @State private var baseURL = ""
    @State private var modelClinical = ""
    @State private var modelReasoning = ""
    @State private var modelOCR = ""
    @State private var hardwareProfile: HardwareProfile = .custom

    @State private var isLoading = false
    @State private var isSaving = false
    @State private var isTesting = false
    @State private var errorMessage: String?
    @State private var testMessage: String?
    @State private var testSuccess: Bool?
    @State private var missingModels: [String] = []
    @State private var ocrStatus: OCRModelStatus?
    @State private var mlxStatus: MLXStatus?
    /* @Codex */
    @State private var runtimeSnapshot: AIRuntimeSnapshot?
    @State private var didLoad = false
    @State private var previousProvider: Provider = .ollama

    var body: some View {
        let content = VStack(alignment: .leading, spacing: 16) {
            Text("Controllo Stack AI")
                .font(.title2.weight(.semibold))

                if isLoading {
                    ProgressView("Caricamento...")
                }

                GroupBox("Profilo hardware") {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("Profilo", selection: $hardwareProfile) {
                            ForEach(HardwareProfile.allCases) { profile in
                                Text(profile.label).tag(profile)
                            }
                        }
                        .pickerStyle(.segmented)

                        Text("Il profilo hardware sovrascrive i modelli consigliati. Usa \"Personalizzato\" per scegliere manualmente.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Ruoli del Team AI") {
                    VStack(alignment: .leading, spacing: 16) {
                        ModelField(
                            title: "Clinica",
                            description: "Referti, analisi cliniche e sintesi mediche.",
                            value: $modelClinical,
                            suggestions: clinicalSuggestions
                        )

                        Divider()

                        ModelField(
                            title: "Reasoning",
                            description: "Second opinion, ragionamenti complessi e chat avanzata.",
                            value: $modelReasoning,
                            suggestions: reasoningSuggestions
                        )

                        Divider()

                        ModelField(
                            title: "OCR",
                            description: "Documenti scannerizzati e import cartaceo.",
                            value: $modelOCR,
                            suggestions: ocrSuggestions
                        )
                        if provider != .ollama {
                            /* @Codex */
                            Text("Nota: l'OCR usa sempre Ollama per compatibilita con i modelli vision.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Infrastruttura") {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("Provider", selection: $provider) {
                            ForEach(Provider.allCases) { item in
                                Text(item.label).tag(item)
                            }
                        }
                        .pickerStyle(.segmented)

                        TextField("Base URL", text: $baseURL)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.callout, design: .monospaced))

                        Text("Esempio: http://127.0.0.1:11434/v1")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if provider == .apple {
                            /* @Codex */
                            Text("Apple Intelligence è sperimentale. In assenza di integrazione diretta, viene usato Ollama come fallback.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Diagnostica") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button(isTesting ? "Test in corso..." : "Test connessione") {
                                Task { await runDiagnostics() }
                            }
                            .disabled(isTesting)

                            if provider == .mlx {
                                Button("Avvia MLX") {
                                    Task { await startMLX() }
                                }
                                Button("Ferma MLX") {
                                    Task { await stopMLX() }
                                }
                            }
                        }

                        if let testMessage {
                            Text(testMessage)
                                .font(.caption)
                                .foregroundStyle(testSuccess == true ? .green : .red)
                        }

                        if !missingModels.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Modelli mancanti:")
                                    .font(.caption.weight(.semibold))
                                ForEach(missingModels, id: \.self) { model in
                                    Text(model)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }

                        if let status = ocrStatus {
                            Text("OCR: \(status.message)")
                                .font(.caption)
                                .foregroundStyle(status.available ? .green : .secondary)
                        }

                        if let mlxStatus {
                            Text("MLX: \(mlxStatus.status ?? "sconosciuto")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        /* @Codex */
                        if let runtimeSnapshot {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Runtime effettivo")
                                    .font(.caption.weight(.semibold))
                                ForEach(runtimeSnapshot.all) { item in
                                    RuntimeTaskRow(item: item)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                HStack {
                    Button(isSaving ? "Salvataggio..." : "Salva configurazione") {
                        Task { await save() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving)

                    Spacer()
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

            Spacer()
        }
        .padding(embedded ? 0 : 24)

        return Group {
            if embedded {
                content
            } else {
                ScrollView {
                    content
                }
            }
        }
        .task {
            await load()
        }
        .onChange(of: provider) { newValue in
            guard didLoad else { return }
            let defaultForPrevious = defaultURL(for: previousProvider)
            if baseURL.isEmpty || baseURL == defaultForPrevious {
                baseURL = defaultURL(for: newValue)
            }
            previousProvider = newValue
        }
        .onChange(of: hardwareProfile) { newValue in
            guard didLoad else { return }
            if newValue != .custom {
                applyHardwareProfile(newValue)
            }
        }
    }

    private var clinicalSuggestions: [ModelSuggestion] {
        [
            ModelSuggestion(
                name: "qwen3.5:35b-a3b",
                description: "Qwen 3.5 35B A3B (Default consigliato)"
            ),
            ModelSuggestion(
                name: "qwen2.5:32b",
                description: "Qwen 2.5 32B (Alternativa)"
            ),
            ModelSuggestion(
                name: "qwen2.5:14b",
                description: "Qwen 2.5 14B (Bilanciato)"
            ),
            ModelSuggestion(
                name: "qwen2.5:7b",
                description: "Qwen 2.5 7B (Leggero)"
            ),
            ModelSuggestion(
                name: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF",
                description: "MedGemma 1.5 4B (Specialistico medico, non default)"
            ),
            ModelSuggestion(
                name: "mlx-community/medgemma-1.5-4b-it-bf16",
                description: "MedGemma 1.5 4B MLX (Specialistico Apple Silicon, non default)"
            )
        ]
    }

    private var reasoningSuggestions: [ModelSuggestion] {
        [
            ModelSuggestion(
                name: "qwen3.5:35b-a3b",
                description: "Qwen 3.5 35B A3B (Default)"
            ),
            ModelSuggestion(
                name: "qwen2.5:32b",
                description: "Qwen 2.5 32B (Alternativa potente)"
            ),
            ModelSuggestion(
                name: "qwen2.5:14b",
                description: "Qwen 2.5 14B (Bilanciato)"
            ),
            ModelSuggestion(
                name: "qwen2.5:7b",
                description: "Qwen 2.5 7B (Leggero)"
            )
        ]
    }

    private var ocrSuggestions: [ModelSuggestion] {
        [
            ModelSuggestion(
                name: "deepseek-ocr",
                description: "DeepSeek OCR 2 (Consigliato)"
            ),
            ModelSuggestion(
                name: "minicpm-v:8b-2.6",
                description: "MiniCPM-V 8B (Alternativo)"
            ),
            ModelSuggestion(
                name: "llava:13b",
                description: "LLaVA 13B (Vision)"
            )
        ]
    }

    @MainActor
    private func load() async {
        if isLoading { return }
        isLoading = true
        defer {
            isLoading = false
            didLoad = true
            previousProvider = provider
        }

        do {
            let providerValue = try await LocalAPIClient.shared.fetchSetting(key: "aiProvider") ?? "ollama"
            provider = Provider(rawValue: providerValue) ?? .ollama

            let hardware = try await LocalAPIClient.shared.fetchSetting(key: "hardwareProfile") ?? "custom"
            hardwareProfile = HardwareProfile(rawValue: hardware) ?? .custom

            let aiUrl = try await LocalAPIClient.shared.fetchSetting(key: "aiUrl")
            let legacyUrl = try await LocalAPIClient.shared.fetchSetting(key: "ollamaUrl")
            baseURL = aiUrl ?? legacyUrl ?? defaultURL(for: provider)

            let modelClinicalValue = try await LocalAPIClient.shared.fetchSetting(key: "aiModel_clinical")
            let modelLegacy = try await LocalAPIClient.shared.fetchSetting(key: "aiModel")
            /* @Codex */
            let defaultClinical = provider == .mlx
                ? "mlx-community/medgemma-1.5-4b-it-bf16"
                : "qwen3.5:35b-a3b"
            let normalizedLegacyClinical = normalizeLegacyClinicalModel(modelLegacy, provider: provider)
            modelClinical = modelClinicalValue ?? normalizedLegacyClinical ?? defaultClinical

            /* @Codex */
            let defaultReasoning = provider == .mlx
                ? "mlx-community/medgemma-1.5-4b-it-bf16"
                : "qwen3.5:35b-a3b"
            modelReasoning = try await LocalAPIClient.shared.fetchSetting(key: "aiModel_reasoning") ?? defaultReasoning
            modelOCR = try await LocalAPIClient.shared.fetchSetting(key: "aiModel_ocr") ?? "deepseek-ocr"
        } catch {
            errorMessage = "Impossibile leggere la configurazione AI"
        }
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        var updates: [String: String] = [
            "aiProvider": provider.rawValue,
            "aiUrl": baseURL,
            "aiModel_clinical": modelClinical,
            "aiModel_reasoning": modelReasoning,
            "aiModel_ocr": modelOCR,
            "aiModel": modelClinical,
            "hardwareProfile": hardwareProfile.rawValue
        ]
        if provider == .ollama {
            updates["ollamaUrl"] = baseURL
        }

        do {
            try await LocalAPIClient.shared.saveSettings(updates)
            testMessage = "Configurazione salvata."
            testSuccess = true
        } catch {
            errorMessage = "Salvataggio fallito"
        }
    }

    @MainActor
    private func runDiagnostics() async {
        if isTesting { return }
        isTesting = true
        testMessage = nil
        testSuccess = nil
        missingModels = []
        ocrStatus = nil
        mlxStatus = nil
        runtimeSnapshot = nil
        defer { isTesting = false }

        do {
            do {
                try await LocalAPIClient.shared.testConnection()
            } catch {
                testMessage = "API locale non raggiungibile. Verifica TLS PIN e token locale."
                testSuccess = false
                return
            }

            /* @Codex */
            let snapshot = try await AISettingsResolver.resolveRuntimeSnapshot()
            runtimeSnapshot = snapshot
            let effectiveProvider = snapshot.clinical.provider
            let resolvedConfig = snapshot.clinical
            let shouldFallbackToOllama = (provider == .mlx && effectiveProvider == "ollama") || provider == .apple

            let ollamaTasks = snapshot.all.filter { $0.provider == "ollama" }
            let mlxTasks = snapshot.all.filter { $0.provider == "mlx" }

            if provider == .apple {
                testMessage = "Apple Intelligence sperimentale, uso Ollama."
            } else if shouldFallbackToOllama {
                testMessage = "MLX non attivo, uso Ollama."
            }

            if !ollamaTasks.isEmpty {
                /* @Codex */
                let probeBaseURL = ollamaTasks.first?.baseURL ?? resolvedConfig.baseURL
                let models = try await LocalAPIClient.shared.listAIModels(baseURL: probeBaseURL)
                let modelNames = models.map { $0.name }
                /* @Codex */
                let requiredModels = Array(Set(ollamaTasks.map { $0.model }))
                let fallbackRequired = shouldFallbackToOllama
                    ? Array(Set(requiredModels + ["qwen3.5:35b-a3b", "qwen2.5:14b", "deepseek-ocr"]))
                    : requiredModels
                missingModels = missingModelsList(from: modelNames, required: fallbackRequired)
                let base = missingModels.isEmpty ? "Ollama raggiungibile e modelli presenti." : "Ollama raggiungibile, alcuni modelli mancano."
                testMessage = testMessage == nil ? base : "\(testMessage!) \(base)"
            }

            if !mlxTasks.isEmpty {
                for task in mlxTasks {
                    _ = try await LocalAPIClient.shared.aiChat(prompt: "ping", model: task.model, baseURL: task.baseURL, maxTokens: 16, temperature: 0.2)
                }
                testMessage = testMessage ?? "MLX operativo."
            }

            mlxStatus = try? await LocalAPIClient.shared.fetchMLXStatus()

            ocrStatus = try? await LocalAPIClient.shared.checkOCRStatus()
            testSuccess = missingModels.isEmpty && (ocrStatus?.available ?? true)
            if let ocrStatus, !ocrStatus.available {
                let suffix = " OCR non disponibile."
                testMessage = testMessage == nil ? suffix.trimmingCharacters(in: .whitespaces) : "\(testMessage!)\(suffix)"
            }
        } catch {
            /* @Codex */
            let nsError = error as NSError
            print("[AI Diagnostics] Error type=\(type(of: error)) domain=\(nsError.domain) code=\(nsError.code) desc=\(nsError.localizedDescription)")
            testMessage = diagnosticErrorMessage(error)
            testSuccess = false
        }
    }

    @MainActor
    private func startMLX() async {
        do {
            try await LocalAPIClient.shared.startMLX()
            mlxStatus = try? await LocalAPIClient.shared.fetchMLXStatus()
        } catch {
            testMessage = "Avvio MLX fallito."
            testSuccess = false
        }
    }

    @MainActor
    private func stopMLX() async {
        do {
            try await LocalAPIClient.shared.stopMLX()
            mlxStatus = try? await LocalAPIClient.shared.fetchMLXStatus()
        } catch {
            testMessage = "Stop MLX fallito."
            testSuccess = false
        }
    }

    private func defaultURL(for provider: Provider) -> String {
        provider == .mlx ? "http://127.0.0.1:8080/v1" : "http://127.0.0.1:11434/v1"
    }

    /* @Codex */
    private func normalizeLegacyClinicalModel(_ model: String?, provider: Provider) -> String? {
        guard provider != .mlx else { return model }
        guard let model else { return nil }
        return Self.staleLegacyDefaults.contains(model) ? nil : model
    }

    private func applyHardwareProfile(_ profile: HardwareProfile) {
        /* @Codex */
        let mlxDefault = "mlx-community/medgemma-1.5-4b-it-bf16"
        let isMLX = provider == .mlx

        switch profile {
        case .low:
            if isMLX {
                modelClinical = mlxDefault
                modelReasoning = mlxDefault
            } else {
                modelClinical = "qwen2.5:7b"
                modelReasoning = "qwen2.5:7b"
            }
        case .medium:
            if isMLX {
                modelClinical = mlxDefault
                modelReasoning = mlxDefault
            } else {
                modelClinical = "qwen2.5:14b"
                modelReasoning = "qwen2.5:14b"
            }
        case .high:
            if isMLX {
                modelClinical = mlxDefault
                modelReasoning = mlxDefault
            } else {
                modelClinical = "qwen3.5:35b-a3b"
                modelReasoning = "qwen3.5:35b-a3b"
            }
        case .custom:
            break
        }
    }

    /* @Codex */
    private func diagnosticErrorMessage(_ error: Error) -> String {
        if let apiError = error as? LocalAPIError {
            return apiError.localizedDescription
        }
        /* @Codex */
        if error is DecodingError {
            return "Formato risposta non valido dal provider AI."
        }
        /* @Codex */
        let nsError = error as NSError
        if nsError.domain == NSCocoaErrorDomain && (nsError.code == 3840 || nsError.code == 4864) {
            return "Formato risposta non valido dal provider AI."
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled, .secureConnectionFailed, .serverCertificateUntrusted:
                return "Handshake TLS fallito. Rigenera la configurazione locale."
            case .cannotConnectToHost, .timedOut, .networkConnectionLost, .notConnectedToInternet:
                return "Server locale non raggiungibile."
            case .badServerResponse:
                return "Risposta non valida dal server. Verifica autorizzazione e sessione."
            default:
                break
            }
        }
        return "Connessione non riuscita: \(error.localizedDescription)"
    }

    /* @Codex */
    private func missingModelsList(from available: [String], required override: [String]? = nil) -> [String] {
        let required = (override ?? [modelClinical, modelReasoning, modelOCR])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        return required.filter { model in
            !available.contains { candidate in
                let normalizedCandidate = candidate.lowercased()
                let normalizedModel = model.lowercased()
                return normalizedCandidate == normalizedModel
                    || normalizedCandidate == "\(normalizedModel):latest"
                    || normalizedCandidate.hasPrefix("\(normalizedModel):")
            }
        }
    }
}

/* @Codex */
private struct RuntimeTaskRow: View {
    let item: AIRuntimeTaskConfig

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(item.title): \(item.provider.uppercased()) · \(item.model)")
                .font(.caption)
                .fontWeight(.semibold)
            Text(item.baseURL)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ModelField: View {
    let title: String
    let description: String
    @Binding var value: String
    let suggestions: [AIControlPanelView.ModelSuggestion]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("Nome modello", text: $value)
                .textFieldStyle(.roundedBorder)
                .font(.system(.callout, design: .monospaced))

            if !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(suggestions) { suggestion in
                        Button {
                            value = suggestion.name
                        } label: {
                            HStack {
                                Text(suggestion.name)
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                Spacer()
                                Text(suggestion.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
