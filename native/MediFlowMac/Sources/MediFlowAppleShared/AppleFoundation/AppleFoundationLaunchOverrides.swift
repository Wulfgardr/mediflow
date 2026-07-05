import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct AppleFoundationLaunchOverrides: Equatable {
    struct AutomaticActions: Equatable {
        var autoDiscover = false
        var autoLogin = false
        var autoLoadPatients = false

        func shouldAutoLoadPatients(hasActiveSession: Bool) -> Bool {
            guard autoLoadPatients else { return false }
            return !autoLogin || hasActiveSession
        }
    }

    var initialSection: AppleFoundationSection?
    var serverURL: String?
    var tlsPin: String?
    var pairedClientId: String?
    var pairedClientToken: String?
    var username: String?
    var password: String?
    var ambulatoryId: String?
    var automaticActions = AutomaticActions()

    static func load(processInfo: ProcessInfo = .processInfo) -> AppleFoundationLaunchOverrides {
        load(environment: processInfo.environment)
    }

    static func load(environment: [String: String]) -> AppleFoundationLaunchOverrides {
        AppleFoundationLaunchOverrides(
            initialSection: normalizedSection(environment["MEDIFLOW_APPLE_INITIAL_SECTION"]),
            serverURL: normalized(environment["MEDIFLOW_HOMEBASE_SERVER_URL"]),
            tlsPin: normalized(environment["MEDIFLOW_HOMEBASE_TLS_PIN"]),
            pairedClientId: normalized(environment["MEDIFLOW_HOMEBASE_PAIRED_CLIENT_ID"]),
            pairedClientToken: normalized(environment["MEDIFLOW_HOMEBASE_PAIRED_CLIENT_TOKEN"]),
            username: normalized(environment["MEDIFLOW_HOMEBASE_USERNAME"]),
            password: normalized(environment["MEDIFLOW_HOMEBASE_OPERATOR_PIN"]),
            ambulatoryId: normalized(environment["MEDIFLOW_HOMEBASE_AMBULATORY_ID"]),
            automaticActions: AutomaticActions(
                autoDiscover: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTODISCOVER"]),
                autoLogin: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTOLOGIN"]),
                autoLoadPatients: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS"])
            )
        )
    }

    private static func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func normalizedSection(_ value: String?) -> AppleFoundationSection? {
        guard let normalized = normalized(value)?.lowercased() else { return nil }
        return AppleFoundationSection(rawValue: normalized)
    }

    private static func normalizedFlag(_ value: String?) -> Bool {
        guard let normalized = normalized(value)?.lowercased() else { return false }
        return ["1", "true", "yes", "on"].contains(normalized)
    }
}
