import MediFlowAppleShared
import SwiftUI

@main
struct MediFlowMacApp: App {
    @StateObject private var store = OncologyPrototypeStore()

    var body: some Scene {
        WindowGroup {
            AppleFoundationMobileRootView(snapshot: .live)
                .frame(minWidth: 1120, minHeight: 760)
        }
        .commands {
            CommandMenu("Prototype oncologico") {
                Button("Reset demo oncologico") {
                    store.resetDemo()
                }
                Button("Riapri onboarding oncologico") {
                    store.reopenOnboarding()
                }
            }
        }

        // @Codex
        Window("Prototype oncologico", id: "oncology-prototype") {
            OncologyPrototypeRootView()
                .environmentObject(store)
                .frame(minWidth: 1280, minHeight: 840)
        }

        Settings {
            HomeBaseRuntimeStatusView()
                .padding(20)
                .frame(width: 720, height: 520)
        }
    }
}
