import Foundation
import MediFlowCore

/* @Codex */
public enum HomeBaseCatalogSearchLimit {
    public static let defaultMaximum = 10
    public static let boundaryMaximum = 50

    public static func clamped(_ limit: Int) -> Int {
        max(1, min(limit, boundaryMaximum))
    }
}

/* @Codex */
public struct HomeBaseDrugSummary: Decodable, Equatable, Identifiable, Sendable {
    public let aic: String
    public let name: String
    public let activePrinciple: String?
    public let company: String?
    public let packaging: String?
    public let drugClass: String?
    public let price: Double?
    public let atc: String?

    public var id: String { aic }

    enum CodingKeys: String, CodingKey {
        case aic
        case name
        case activePrinciple
        case company
        case packaging
        case drugClass = "class"
        case price
        case atc
    }

    public init(
        aic: String,
        name: String,
        activePrinciple: String? = nil,
        company: String? = nil,
        packaging: String? = nil,
        drugClass: String? = nil,
        price: Double? = nil,
        atc: String? = nil
    ) {
        self.aic = aic
        self.name = name
        self.activePrinciple = activePrinciple
        self.company = company
        self.packaging = packaging
        self.drugClass = drugClass
        self.price = price
        self.atc = atc
    }
}

/* @Codex */
public struct HomeBaseExemptionSummary: Decodable, Equatable, Identifiable, Sendable {
    public let code: String
    public let description: String
    public let type: String?
    public let source: String?
    public let startDate: Date?
    public let endDate: Date?
    public let isPharma: Bool?
    public let isSpecialist: Bool?
    public let isNational: Bool?
    public let updatedAt: Date?

    public var id: String { code }

    public init(
        code: String,
        description: String,
        type: String? = nil,
        source: String? = nil,
        startDate: Date? = nil,
        endDate: Date? = nil,
        isPharma: Bool? = nil,
        isSpecialist: Bool? = nil,
        isNational: Bool? = nil,
        updatedAt: Date? = nil
    ) {
        self.code = code
        self.description = description
        self.type = type
        self.source = source
        self.startDate = startDate
        self.endDate = endDate
        self.isPharma = isPharma
        self.isSpecialist = isSpecialist
        self.isNational = isNational
        self.updatedAt = updatedAt
    }
}

/* @Codex */
public struct HomeBaseTerminologyItem: Decodable, Equatable, Identifiable, Sendable {
    public let system: String
    public let code: String
    public let display: String
    public let displayIt: String?
    public let defaultUnit: String?
    public let version: String?
    public let source: String

    public var id: String { "\(system):\(code)" }

    public init(
        system: String,
        code: String,
        display: String,
        displayIt: String? = nil,
        defaultUnit: String? = nil,
        version: String? = nil,
        source: String
    ) {
        self.system = system
        self.code = code
        self.display = display
        self.displayIt = displayIt
        self.defaultUnit = defaultUnit
        self.version = version
        self.source = source
    }
}

/* @Codex */
public struct HomeBaseTerminologyRegistryEntry: Decodable, Equatable, Identifiable, Sendable {
    public let system: String
    public let display: String
    public let version: String?
    public let source: String
    public let status: String
    public let updatedAt: Date?
    public let notes: String?

    public var id: String { system }

    public init(
        system: String,
        display: String,
        version: String? = nil,
        source: String,
        status: String,
        updatedAt: Date? = nil,
        notes: String? = nil
    ) {
        self.system = system
        self.display = display
        self.version = version
        self.source = source
        self.status = status
        self.updatedAt = updatedAt
        self.notes = notes
    }
}

/* @Codex */
public struct TherapyCatalogDraft: Equatable, Sendable {
    public var drugName: String
    public var aic: String
    public var atc: String
    public var activePrinciple: String

    public init(drugName: String = "", aic: String = "", atc: String = "", activePrinciple: String = "") {
        self.drugName = drugName
        self.aic = aic
        self.atc = atc
        self.activePrinciple = activePrinciple
    }
}

/* @Codex */
public enum CatalogSelection {
    public static func applying(_ drug: HomeBaseDrugSummary, to draft: TherapyCatalogDraft) -> TherapyCatalogDraft {
        TherapyCatalogDraft(
            drugName: drug.name,
            aic: drug.aic,
            atc: drug.atc ?? "",
            activePrinciple: drug.activePrinciple ?? ""
        )
    }

    public static func adding(_ exemption: HomeBaseExemptionSummary, to codes: [String]) -> [String] {
        ExemptionCodesCodec.normalizedCodes(codes + [exemption.code])
    }
}
