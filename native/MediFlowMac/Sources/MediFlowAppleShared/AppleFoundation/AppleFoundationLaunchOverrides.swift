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
    var dynamicTypeSizeOverride: DynamicTypeSize?
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
            // @Codex #142: deterministic UI-test coverage for the AX layout policy.
            dynamicTypeSizeOverride: normalizedDynamicTypeSize(
                environment["MEDIFLOW_APPLE_UITEST_DYNAMIC_TYPE_SIZE"]
            ),
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

    private static func normalizedDynamicTypeSize(_ value: String?) -> DynamicTypeSize? {
        switch normalized(value)?.lowercased() {
        case "xsmall": return .xSmall
        case "small": return .small
        case "medium": return .medium
        case "large": return .large
        case "xlarge": return .xLarge
        case "xxlarge": return .xxLarge
        case "xxxlarge": return .xxxLarge
        case "accessibility1": return .accessibility1
        case "accessibility2": return .accessibility2
        case "accessibility3": return .accessibility3
        case "accessibility4": return .accessibility4
        case "accessibility5": return .accessibility5
        default: return nil
        }
    }
}
