import SwiftUI

extension View {
    // @Codex: compatibility alias; clinical surfaces now share one opaque primitive.
    func cardStyle() -> some View {
        clinicalCardStyle()
    }
}

extension AppleDeliveryPhase {
    var tintColor: Color {
        switch self {
        case .shipping:
            return .green
        case .foundation:
            return .teal
        case .next:
            return .orange
        case .blocked:
            return .red
        }
    }
}
