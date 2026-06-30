import Foundation

// ADR 0071 Fase 1: pure String helpers shared by the core codecs and the Apple
// layers. Lifted out of PairedClinicalTypes.swift (which is SwiftUI-coupled) so
// the platform-free core can use them too.
public extension String {
    /// The string trimmed of surrounding whitespace, or nil if that leaves it empty.
    var trimmedOrNil: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
