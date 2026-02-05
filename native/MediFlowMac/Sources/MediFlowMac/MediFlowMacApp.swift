// Codex: created 2026-02-01
import SwiftUI
import AppKit

@main
struct MediFlowMacApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(SecuritySession.shared)
        }
        .commands {
            CommandGroup(replacing: .appTermination) {
                Button("Esci MediFlow") {
                    NSApp.terminate(nil)
                }
                .keyboardShortcut("q")
            }
            CommandGroup(after: .windowList) {
                Button("Chiudi finestra") {
                    NSApp.keyWindow?.performClose(nil)
                }
                .keyboardShortcut("w")
            }
            CommandGroup(after: .appInfo) {
                Button("Blocca") {
                    SecuritySession.shared.lock()
                }
                .keyboardShortcut("l")
            }
        }

        Settings {
            SettingsView(settings: SettingsStore.shared)
                .environmentObject(SecuritySession.shared)
        }
    }
}
