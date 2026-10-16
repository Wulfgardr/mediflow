// Codex: created 2026-04-17
import MediFlowAppleShared
import SwiftUI
import UIKit

@main
struct MediFlowMobileShellApp: App {
    @StateObject private var appearance = AppleAppearanceStore()

    init() {
        _ = LumeTypography.voice(26)
        let voice = UIFont(name: "Newsreader16pt-Regular", size: 26) ?? UIFont.systemFont(ofSize: 26)
        UINavigationBar.appearance().titleTextAttributes = [.font: voice]
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: voice]
    }

    var body: some Scene {
        WindowGroup {
            AppleFoundationMobileRootView(snapshot: .live, appearance: appearance)
                .preferredColorScheme(appearance.theme.preferredColorScheme)
        }
    }
}
