// A21 parity: privacy shield. Clinical content is sensitive, so redact the whole
// surface when the app is not active (the iOS app-switcher snapshot). Pure
// scene-phase logic is unit-testable; the overlay is applied at the root.
import SwiftUI

enum PrivacyShield {
    /// Whether to cover the UI. On iOS, redact whenever the scene is not active
    /// (inactive/background -> the app-switcher snapshot). On macOS, only when
    /// forced (window blur redaction would be intrusive). `forced` is the UI-test
    /// / explicit override.
    static func shouldRedact(scenePhase: ScenePhase, forced: Bool) -> Bool {
        #if os(iOS)
        return forced || scenePhase != .active
        #else
        return forced
        #endif
    }
}

private struct PrivacyShieldModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.overlay {
            if PrivacyShield.shouldRedact(scenePhase: scenePhase, forced: Self.forcedForUITest) {
                privacyOverlay
            }
        }
    }

    private var privacyOverlay: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .ignoresSafeArea()
            VStack(spacing: 10) {
                Image(systemName: "lock.shield")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("Contenuto clinico protetto")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("privacy-shield")
    }

    private static var forcedForUITest: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_FORCE_PRIVACY"] == "1"
        #else
        return false
        #endif
    }
}

public extension View {
    /// Redact the content with a privacy overlay when the scene is not active.
    func privacyShield() -> some View {
        modifier(PrivacyShieldModifier())
    }
}
