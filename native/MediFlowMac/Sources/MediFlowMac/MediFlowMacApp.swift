import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMacApp: App {
    @StateObject private var store = OncologyPrototypeStore()

    var body: some Scene {
        WindowGroup {
            OncologyPrototypeRootView()
                .environmentObject(store)
                .frame(minWidth: 1280, minHeight: 840)
        }
        .commands {
            CommandMenu("Prototype") {
                Button("Reset demo") {
                    store.resetDemo()
                }
                Button("Riapri onboarding") {
                    store.reopenOnboarding()
                }
            }
        }

        // @Codex
        Window("Apple Rollout", id: "apple-rollout") {
            AppleFoundationWindowContent(snapshot: .live)
                .frame(minWidth: 960, minHeight: 760)
        }

        Settings {
            PrototypeSettingsView()
                .environmentObject(store)
                .frame(width: 520, height: 520)
        }
    }
}
