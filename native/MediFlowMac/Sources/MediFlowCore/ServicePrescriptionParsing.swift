import Foundation

/* @Codex */
public struct ServicePrescriptionItemDraft: Equatable, Sendable {
    public let serviceName: String
    public let serviceCode: String?

    public init(serviceName: String, serviceCode: String? = nil) {
        self.serviceName = serviceName
        self.serviceCode = serviceCode
    }
}

/* @Codex */
public enum ServicePrescriptionParsing {
    public static func parseItemDrafts(_ value: String, fallbackName: String) -> [ServicePrescriptionItemDraft] {
        let lines = value
            .split(whereSeparator: { $0 == "\n" || $0 == ";" })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let source = lines.isEmpty
            ? [fallbackName.trimmingCharacters(in: .whitespacesAndNewlines)].filter { !$0.isEmpty }
            : lines
        return source.map(parseLine)
    }

    private static func parseLine(_ line: String) -> ServicePrescriptionItemDraft {
        let pattern = #"^([A-Za-z0-9._/-]{2,})\s+(.+)$"#
        guard let match = line.range(of: pattern, options: .regularExpression) else {
            return ServicePrescriptionItemDraft(serviceName: line)
        }
        let matched = String(line[match])
        guard let firstSpace = matched.firstIndex(where: { $0.isWhitespace }) else {
            return ServicePrescriptionItemDraft(serviceName: line)
        }
        let code = String(matched[..<firstSpace]).trimmingCharacters(in: .whitespacesAndNewlines)
        let name = String(matched[firstSpace...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.range(of: #"[0-9._/-]"#, options: .regularExpression) != nil, !name.isEmpty else {
            return ServicePrescriptionItemDraft(serviceName: line)
        }
        return ServicePrescriptionItemDraft(serviceName: name, serviceCode: code)
    }

    public static func childServiceCode(for draft: ServicePrescriptionItemDraft, inheritedServiceCode: String?) -> String? {
        draft.serviceCode ?? inheritedServiceCode?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }
}

/* @Codex */
public struct ServicePrescriptionCounters: Equatable, Sendable {
    public let total: Int
    public let items: Int
    public let open: Int
    public let reports: Int
}

/* @Codex */
public enum ServicePrescriptionFiltering {
    public static func sorted(_ prescriptions: [HomeBaseServicePrescriptionSummary]) -> [HomeBaseServicePrescriptionSummary] {
        prescriptions.sorted {
            if $0.prescribedAt != $1.prescribedAt { return $0.prescribedAt > $1.prescribedAt }
            return $0.id < $1.id
        }
    }

    public static func sortedItems(_ items: [HomeBaseServicePrescriptionItemSummary]) -> [HomeBaseServicePrescriptionItemSummary] {
        items.sorted {
            if $0.ordinal != $1.ordinal { return $0.ordinal < $1.ordinal }
            return $0.id < $1.id
        }
    }

    public static func counters(
        prescriptions: [HomeBaseServicePrescriptionSummary],
        items: [HomeBaseServicePrescriptionItemSummary]
    ) -> ServicePrescriptionCounters {
        ServicePrescriptionCounters(
            total: prescriptions.count,
            items: items.count,
            open: items.filter { !["performed", "report_received", "cancelled"].contains($0.status) }.count,
            reports: items.filter { $0.status == "report_received" }.count
        )
    }
}

/* @Codex */
public struct ProstheticPrescriptionCounters: Equatable, Sendable {
    public let total: Int
    public let tests: Int
}

/* @Codex */
public enum ProstheticPrescriptionFiltering {
    public static func sorted(_ prescriptions: [HomeBaseProstheticPrescriptionSummary]) -> [HomeBaseProstheticPrescriptionSummary] {
        prescriptions.sorted {
            if $0.prescribedAt != $1.prescribedAt { return $0.prescribedAt > $1.prescribedAt }
            return $0.id < $1.id
        }
    }

    public static func counters(_ prescriptions: [HomeBaseProstheticPrescriptionSummary]) -> ProstheticPrescriptionCounters {
        ProstheticPrescriptionCounters(
            total: prescriptions.count,
            tests: prescriptions.filter { $0.status == "tested" }.count
        )
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
