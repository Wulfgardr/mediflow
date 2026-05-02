// Codex: created 2026-04-17
// @Codex
import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMobileShellApp: App {
    var body: some Scene {
        WindowGroup {
            AppleFoundationMobileRootView(snapshot: .live)
        }
    }
}
