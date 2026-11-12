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
            return PlatformColors.signal(.positive)
        case .foundation:
            return PlatformColors.secondaryInk
        case .next:
            return PlatformColors.signal(.attention)
        case .blocked:
            return PlatformColors.signal(.critical)
        }
    }
}
