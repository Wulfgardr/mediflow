/* @Codex */
import Foundation

public struct NativeAIFunctionPreferences: Codable, Equatable, Sendable {
    public struct Function: Codable, Equatable, Identifiable, Sendable {
        public struct Option: Codable, Equatable, Identifiable, Sendable {
            public let modelOptionId: String
            public let label: String
            public let provider: String
            public let state: String
            public var id: String { modelOptionId }
        }
        public let id: String
        public let enabled: Bool
        public let defaultModelOptionId: String?
        public let defaultSource: String
        public let bindingState: String
        public let options: [Option]
        public var title: String {
            switch id {
            case "patient_insight": "Sintesi paziente"
            case "smart_import": "Importazione assistita"
            case "document_synthesis": "Sintesi documenti"
            case "treatment_reasoning": "Ragionamento terapeutico"
            default: "Funzione non supportata"
            }
        }
    }
    public let schemaVersion: String
    public let revision: String
    public let catalogRevision: String
    public let check: String
    public let functions: [Function]
    public let presets: [String]
    public let apply: String

    public func validate() throws {
        let ids = Set(["patient_insight", "smart_import", "document_synthesis", "treatment_reasoning"])
        guard schemaVersion == "mediflow.function-preferences.v1", check == "configuration_only", apply == "denied",
              revision.range(of: "^sha256_[0-9a-f]{64}$", options: .regularExpression) != nil,
              catalogRevision.range(of: "^sha256_[0-9a-f]{64}$", options: .regularExpression) != nil,
              functions.count == 4, Set(functions.map(\.id)) == ids,
              presets.count == 2, Set(presets) == Set(["host_defaults", "all_off"]) else { throw HomeBaseClientError.contract }
        for function in functions {
            guard ["saved_preference", "host_configuration"].contains(function.defaultSource),
                  ["current", "stale", "unsupported"].contains(function.bindingState),
                  Set(function.options.map(\.id)).count == function.options.count else { throw HomeBaseClientError.contract }
            for option in function.options {
                guard option.modelOptionId.range(of: "^model_option_[0-9a-f]{32}$", options: .regularExpression) != nil,
                      ["ollama", "athena_mlx"].contains(option.provider),
                      ["available_unqualified", "unavailable"].contains(option.state) else { throw HomeBaseClientError.contract }
            }
        }
    }
}

/// Uses the same ID for preview and confirmation. Never includes an endpoint or credential.
public struct NativeAIFunctionCommand: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let commandId: String
    public let expectedRevision: String
    public let expectedCatalogRevision: String
    public let action: String
    public let functionId: String?
    public let enabled: Bool?
    public let defaultModelOptionId: String?
    public let presetId: String?

    public init(snapshot: NativeAIFunctionPreferences, presetId: String, commandId: String = UUID().uuidString) {
        schemaVersion = "mediflow.function-preferences-command.v1"
        self.commandId = commandId; expectedRevision = snapshot.revision; expectedCatalogRevision = snapshot.catalogRevision
        action = "preset"; self.presetId = presetId; functionId = nil; enabled = nil; defaultModelOptionId = nil
    }
    public init(snapshot: NativeAIFunctionPreferences, functionId: String, enabled: Bool, defaultModelOptionId: String?, commandId: String = UUID().uuidString) {
        schemaVersion = "mediflow.function-preferences-command.v1"
        self.commandId = commandId; expectedRevision = snapshot.revision; expectedCatalogRevision = snapshot.catalogRevision
        action = "set"; presetId = nil; self.functionId = functionId; self.enabled = enabled; self.defaultModelOptionId = defaultModelOptionId
    }
    enum CodingKeys: String, CodingKey { case schemaVersion, commandId, expectedRevision, expectedCatalogRevision, action, functionId, enabled, defaultModelOptionId, presetId }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schemaVersion, forKey: .schemaVersion); try c.encode(commandId, forKey: .commandId)
        try c.encode(expectedRevision, forKey: .expectedRevision); try c.encode(expectedCatalogRevision, forKey: .expectedCatalogRevision)
        try c.encode(action, forKey: .action)
        if action == "set" {
            try c.encode(functionId, forKey: .functionId); try c.encode(enabled, forKey: .enabled)
            try c.encode(defaultModelOptionId, forKey: .defaultModelOptionId) // explicit null restores host default
        } else { try c.encode(presetId, forKey: .presetId) }
    }
}
public struct NativeAIFunctionPreview: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let command: NativeAIFunctionCommand
    public let proposed: NativeAIFunctionPreferences
    public let writesPerformed: Int
    public init(schemaVersion: String, command: NativeAIFunctionCommand, proposed: NativeAIFunctionPreferences, writesPerformed: Int) {
        self.schemaVersion = schemaVersion; self.command = command; self.proposed = proposed; self.writesPerformed = writesPerformed
    }
    public func validate(command expected: NativeAIFunctionCommand) throws {
        guard schemaVersion == "mediflow.function-preferences-preview.v1", command == expected, writesPerformed == 0 else { throw HomeBaseClientError.contract }
        try proposed.validate()
    }
}
