// Codex: created 2026-02-01
import Foundation

struct AIConfig {
    let baseURL: String
    let model: String
}

enum AIModelTask: String {
    case clinical
    case reasoning
    case ocr
}

/* @Codex */
struct AIRuntimeTaskConfig: Identifiable {
    let task: AIModelTask
    let provider: String
    let baseURL: String
    let model: String

    var id: String { task.rawValue }

    var title: String {
        switch task {
        case .clinical: return "Clinica"
        case .reasoning: return "Reasoning"
        case .ocr: return "OCR"
        }
    }
}

/* @Codex */
struct AIRuntimeSnapshot {
    let clinical: AIRuntimeTaskConfig
    let reasoning: AIRuntimeTaskConfig
    let ocr: AIRuntimeTaskConfig

    var all: [AIRuntimeTaskConfig] {
        [clinical, reasoning, ocr]
    }
}

enum AISettingsResolver {
    /* @Codex */
    static func resolveProvider() async -> String {
        return await resolveProvider(for: .clinical)
    }

    /* @Codex */
    static func resolveProvider(for task: AIModelTask) async -> String {
        let configuredProvider = (try? await LocalAPIClient.shared.fetchSetting(key: "aiProvider")) ?? "ollama"
        if configuredProvider == "apple" {
            return "ollama"
        }
        let resolved = await resolvedProvider(configuredProvider)
        if task == .ocr {
            return "ollama"
        }
        return resolved
    }

    static func resolveClinicalConfig() async throws -> AIConfig {
        try await resolveConfig(for: .clinical)
    }

    static func resolveReasoningConfig() async throws -> AIConfig {
        try await resolveConfig(for: .reasoning)
    }

    static func resolveOCRConfig() async throws -> AIConfig {
        try await resolveConfig(for: .ocr)
    }

    static func resolveConfig(for task: AIModelTask) async throws -> AIConfig {
        let configuredProvider = try await LocalAPIClient.shared.fetchSetting(key: "aiProvider") ?? "ollama"
        /* @Codex */
        let provider = await resolveProvider(for: task)
        let aiUrl = try await LocalAPIClient.shared.fetchSetting(key: "aiUrl")
        let legacyUrl = try await LocalAPIClient.shared.fetchSetting(key: "ollamaUrl")
        let defaultBase = provider == "mlx" ? "http://127.0.0.1:8080/v1" : "http://127.0.0.1:11434/v1"
        let baseURL: String
        if configuredProvider == "mlx" && provider == "ollama" {
            /* @Codex */
            // MLX non attivo: evita URL 8080 se salvato come aiUrl e ripiega su Ollama.
            if let legacyUrl {
                baseURL = legacyUrl
            } else if let aiUrl, !aiUrl.contains(":8080") {
                baseURL = aiUrl
            } else {
                baseURL = defaultBase
            }
        } else if configuredProvider == "apple" {
            /* @Codex */
            if let legacyUrl {
                baseURL = legacyUrl
            } else if let aiUrl, !aiUrl.contains(":8080") {
                baseURL = aiUrl
            } else {
                baseURL = defaultBase
            }
        } else {
            baseURL = aiUrl ?? legacyUrl ?? defaultBase
        }

        let modelKey: String
        let defaultModel: String
        switch task {
        case .clinical:
            modelKey = "aiModel_clinical"
            defaultModel = provider == "mlx"
                ? "mlx-community/medgemma-1.5-4b-it-bf16"
                : "hf.co/unsloth/medgemma-1.5-4b-it-GGUF"
        case .reasoning:
            modelKey = "aiModel_reasoning"
            /* @Codex */
            defaultModel = provider == "mlx"
                ? "mlx-community/medgemma-1.5-4b-it-bf16"
                : "qwen2.5:32b"
        case .ocr:
            modelKey = "aiModel_ocr"
            defaultModel = "deepseek-ocr"
        }

        let modelValue = try await LocalAPIClient.shared.fetchSetting(key: modelKey)
        let modelLegacy = (task == .clinical) ? try await LocalAPIClient.shared.fetchSetting(key: "aiModel") : nil
        let model = modelValue ?? modelLegacy ?? defaultModel

        return AIConfig(baseURL: baseURL, model: model)
    }

    /* @Codex */
    static func resolveRuntimeSnapshot() async throws -> AIRuntimeSnapshot {
        async let clinical = resolveRuntimeTask(for: .clinical)
        async let reasoning = resolveRuntimeTask(for: .reasoning)
        async let ocr = resolveRuntimeTask(for: .ocr)

        return try await AIRuntimeSnapshot(
            clinical: clinical,
            reasoning: reasoning,
            ocr: ocr
        )
    }

    /* @Codex */
    private static func resolveRuntimeTask(for task: AIModelTask) async throws -> AIRuntimeTaskConfig {
        let provider = await resolveProvider(for: task)
        let config = try await resolveConfig(for: task)
        return AIRuntimeTaskConfig(
            task: task,
            provider: provider,
            baseURL: config.baseURL,
            model: config.model
        )
    }

    /* @Codex */
    private static func resolvedProvider(_ configured: String) async -> String {
        guard configured == "mlx" else { return configured }
        if await isMLXOnline() {
            return configured
        }
        await persistOllamaFallback()
        return "ollama"
    }

    /* @Codex */
    private static func isMLXOnline() async -> Bool {
        if let status = try? await LocalAPIClient.shared.fetchMLXStatus(),
           status.status?.lowercased() == "online" {
            return true
        }
        return await probeMLXHTTP()
    }

    /* @Codex */
    private static func probeMLXHTTP() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8080/v1/models") else { return false }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1.5
        config.timeoutIntervalForResource = 2.0
        let session = URLSession(configuration: config)

        do {
            let (_, response) = try await session.data(from: url)
            if let http = response as? HTTPURLResponse {
                return http.statusCode < 500
            }
        } catch {
            return false
        }
        return false
    }

    /* @Codex */
    private static func persistOllamaFallback() async {
        do {
            let current = try await LocalAPIClient.shared.fetchSetting(key: "aiProvider") ?? "ollama"
            guard current == "mlx" else { return }

            let aiUrl = try await LocalAPIClient.shared.fetchSetting(key: "aiUrl")
            let legacyUrl = try await LocalAPIClient.shared.fetchSetting(key: "ollamaUrl")

            var updates: [String: String] = ["aiProvider": "ollama"]
            if let aiUrl, aiUrl.contains(":8080") {
                updates["aiUrl"] = legacyUrl ?? "http://127.0.0.1:11434/v1"
            }
            try await LocalAPIClient.shared.saveSettings(updates)
        } catch {
            // Ignore persistence errors (likely unauthenticated).
        }
    }
}
