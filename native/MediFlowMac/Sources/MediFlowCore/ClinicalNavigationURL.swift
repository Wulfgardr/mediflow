import Foundation

/* @Codex */
/// Presentation destinations only; none of these values is an API command.
public enum ClinicalNavigationArea: String, CaseIterable, Sendable {
    case patients, agenda, diary, analytics, scales, settings
    case runtime, overview, milestones, host, repertori

    public func isAvailable(on platform: ClinicalNavigationPlatform) -> Bool {
        platform == .macOS || (self != .host && self != .repertori)
    }
}

public enum ClinicalNavigationPlatform: Sendable {
    case macOS, mobile
}

public enum ClinicalNavigationPatientSection: String, CaseIterable, Sendable {
    case overview, diary, scales, therapies, clinical, prescriptions, documents
}

public enum ClinicalNavigationDestination: Equatable, Sendable {
    case area(ClinicalNavigationArea)
    case patient(id: String, section: ClinicalNavigationPatientSection)
}

public enum ClinicalNavigationURL {
    /// An opaque runtime ID, not a name, credential, URL or filesystem path.
    public static func isValidPatientID(_ value: String) -> Bool {
        let bytes = value.utf8
        return (1...512).contains(bytes.count) && value != "." && value != ".."
            && bytes.allSatisfy {
                (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0)
                    || $0 == 45 || $0 == 95 || $0 == 46
            }
    }

    /// Reject ambiguity instead of selecting one of two conflicting parameters.
    /// URLComponents decodes each component once; there is no second decoding pass.
    public static func parse(_ url: URL) -> ClinicalNavigationDestination? {
        guard url.baseURL == nil, url.absoluteString.utf8.count <= 2_048,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "mediflow",
              components.percentEncodedHost?.lowercased() == "navigate",
              components.percentEncodedPath.isEmpty,
              components.user == nil, components.password == nil, components.port == nil,
              components.fragment == nil, let items = components.queryItems else { return nil }
        var values: [String: String] = [:]
        for item in items {
            guard ["area", "paziente", "section"].contains(item.name),
                  values[item.name] == nil, let value = item.value, !value.isEmpty else { return nil }
            values[item.name] = value
        }
        guard let rawArea = values["area"], let area = ClinicalNavigationArea(rawValue: rawArea) else {
            return nil
        }
        guard let patientID = values["paziente"] else {
            return values["section"] == nil ? .area(area) : nil
        }
        guard area == .patients, isValidPatientID(patientID),
              let section = ClinicalNavigationPatientSection(rawValue: values["section"] ?? "overview") else {
            return nil
        }
        return .patient(id: patientID, section: section)
    }
}
