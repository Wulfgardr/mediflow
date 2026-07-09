import Foundation

/// Il boundary home-base serializza le date con `Date.toISOString()` di JavaScript,
/// che emette SEMPRE i millisecondi (`2026-07-08T10:00:00.000Z`). La strategia
/// `.iso8601` di JSONDecoder li accetta solo su Foundation recenti: su toolchain
/// stabili il decode fallisce. Questa strategia accetta entrambe le forme.
public enum HomeBaseDateCoding {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    public static func parseISO8601(_ raw: String) -> Date? {
        fractional.date(from: raw) ?? plain.date(from: raw)
    }

    public static let tolerantISO8601Strategy = JSONDecoder.DateDecodingStrategy.custom { decoder in
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let date = parseISO8601(raw) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Data ISO8601 non valida: \(raw)"
            )
        }
        return date
    }
}
