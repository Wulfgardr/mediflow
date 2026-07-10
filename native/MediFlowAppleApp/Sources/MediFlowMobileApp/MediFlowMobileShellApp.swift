// Codex: created 2026-04-17
// @Codex
import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMobileShellApp: App {
    @StateObject private var appearance = AppleAppearanceStore()

    var body: some Scene {
        WindowGroup {
            AppleFoundationMobileRootView(snapshot: .live, appearance: appearance)
                .preferredColorScheme(appearance.theme.preferredColorScheme)
        }
    }
}
