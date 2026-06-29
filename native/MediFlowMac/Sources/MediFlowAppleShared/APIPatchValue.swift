// Fase 0/1: shared optimistic-update contract primitive.
// Extracted from the retired MediFlowMac LocalAPIClient so the universal app has
// one tri-state encoding for partial (PATCH-style) updates:
//   .omit  -> field absent from the JSON body
//   .null  -> field present with an explicit JSON null (clears the value)
//   .value -> field present with the encoded value
// Fase 1 migrates the live HomeBase update payloads (which today use plain
// optionals + ad-hoc flags such as shouldEncodeEndDate) onto this type once the
// /api/v1/network backend's omit-vs-null semantics are confirmed.
import Foundation

public enum PatchValue<Value> {
    case omit
    case null
    case value(Value)
}

// A PatchValue is Sendable when its payload is, so structs that carry PatchValue
// fields (the HomeBase update payloads) can stay Sendable without a warning under
// the Swift 6 language mode.
extension PatchValue: Sendable where Value: Sendable {}

extension KeyedEncodingContainer {
    mutating func encodePatch<T: Encodable>(_ value: PatchValue<T>, forKey key: Key) throws {
        switch value {
        case .omit:
            break
        case .null:
            try encodeNil(forKey: key)
        case .value(let wrapped):
            try encode(wrapped, forKey: key)
        }
    }
}
