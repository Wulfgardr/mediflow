/* @Codex */
#if DEBUG
import Foundation

/// A deterministic, debug-only presentation override for the paired-status UI.
///
/// It deliberately replaces only the value given to `MobilePairedStatusView`.
/// It never mutates pairing, session, cache, or authorization state, so an
/// automated UI test can prove the presentation without simulating a host.
struct MobilePairedStatusUITestOverride: Equatable {
    private static let environmentKey = "MEDIFLOW_APPLE_UITEST_PAIRED_STATUS"

    enum State: String, CaseIterable {
        case online
        case cached
        case offline
        case sessionExpired
        case error
        case loading
    }

    let state: State

    static func load(processInfo: ProcessInfo = .processInfo) -> Self? {
        load(environment: processInfo.environment)
    }

    static func load(environment: [String: String]) -> Self? {
        guard let value = environment[environmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            let state = parse(value)
        else {
            return nil
        }
        return Self(state: state)
    }

    private static func parse(_ value: String) -> State? {
        if value == "sessionexpired" { return .sessionExpired }
        return State(rawValue: value)
    }

    var presentation: MobilePairedStatusPresentation {
        switch state {
        case .online:
            return .make(
                connectionState: .pairedOnline,
                isWorking: false,
                errorMessage: nil,
                reconciliationLine: "Home-base disponibile."
            )
        case .cached:
            return .make(
                connectionState: .cached,
                isWorking: false,
                errorMessage: nil,
                reconciliationLine: "Snapshot locale disponibile."
            )
        case .offline:
            return .make(
                connectionState: .pairedOfflineDegraded,
                isWorking: false,
                errorMessage: nil,
                reconciliationLine: "Cache cifrata locale. Nessuna scrittura offline."
            )
        case .sessionExpired:
            return .make(
                connectionState: .sessionExpired,
                isWorking: false,
                errorMessage: nil,
                reconciliationLine: ""
            )
        case .error:
            return .make(
                connectionState: .pairedOnline,
                isWorking: false,
                errorMessage: "errore sintetico",
                reconciliationLine: ""
            )
        case .loading:
            return .make(
                connectionState: .pairedOnline,
                isWorking: true,
                errorMessage: nil,
                reconciliationLine: ""
            )
        }
    }
}
#endif
