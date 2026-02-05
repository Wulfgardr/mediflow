// Codex: created 2026-02-01
import Foundation

enum LocalAPISettings {
    static let baseURLKey = "localApiBaseURL"
    static let tlsPinKey = "localApiTLSPin"
    static let selectedAmbulatoryKey = "selectedAmbulatoryId"
    static let defaultBaseURL = "https://localhost:3443/api/v1"

    static func loadBaseURLString() -> String {
        UserDefaults.standard.string(forKey: baseURLKey) ?? defaultBaseURL
    }

    static func loadTLSPin() -> String {
        UserDefaults.standard.string(forKey: tlsPinKey) ?? ""
    }

    static func saveBaseURLString(_ value: String) {
        UserDefaults.standard.setValue(value, forKey: baseURLKey)
    }

    static func saveTLSPin(_ value: String) {
        UserDefaults.standard.setValue(value, forKey: tlsPinKey)
    }

    static func loadSelectedAmbulatoryId() -> String? {
        UserDefaults.standard.string(forKey: selectedAmbulatoryKey)
    }

    static func saveSelectedAmbulatoryId(_ value: String?) {
        if let value, !value.isEmpty {
            UserDefaults.standard.setValue(value, forKey: selectedAmbulatoryKey)
        } else {
            UserDefaults.standard.removeObject(forKey: selectedAmbulatoryKey)
        }
    }
}
