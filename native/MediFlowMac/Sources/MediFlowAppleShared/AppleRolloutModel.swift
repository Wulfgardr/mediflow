// Codex: created 2026-04-17
// @Codex
import Foundation

public enum AppleDeliveryPhase: String, CaseIterable, Codable, Sendable {
    case shipping
    case foundation
    case next
    case blocked

    public var title: String {
        switch self {
        case .shipping:
            return "Su main"
        case .foundation:
            return "Prima build"
        case .next:
            return "Prossimo slice"
        case .blocked:
            return "Bloccato"
        }
    }

    public var symbolName: String {
        switch self {
        case .shipping:
            return "checkmark.circle.fill"
        case .foundation:
            return "hammer.circle.fill"
        case .next:
            return "arrow.right.circle.fill"
        case .blocked:
            return "exclamationmark.triangle.fill"
        }
    }
}

public enum AppleFoundationSection: String, CaseIterable, Identifiable, Sendable {
    case overview
    case modules
    case milestones

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .overview:
            return "Panoramica"
        case .modules:
            return "Moduli"
        case .milestones:
            return "Tappe"
        }
    }

    public var symbolName: String {
        switch self {
        case .overview:
            return "square.grid.2x2"
        case .modules:
            return "list.bullet.rectangle"
        case .milestones:
            return "flag.pattern.checkered"
        }
    }
}

public struct ApplePlatformStatus: Hashable, Sendable {
    public let phase: AppleDeliveryPhase
    public let detail: String

    public init(phase: AppleDeliveryPhase, detail: String) {
        self.phase = phase
        self.detail = detail
    }
}

public struct AppleCapabilityLane: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let summary: String
    public let sourceOfTruth: String
    public let macOS: ApplePlatformStatus
    public let iPhone: ApplePlatformStatus
    public let iPad: ApplePlatformStatus
    public let nextIssue: String

    public init(
        id: String,
        title: String,
        summary: String,
        sourceOfTruth: String,
        macOS: ApplePlatformStatus,
        iPhone: ApplePlatformStatus,
        iPad: ApplePlatformStatus,
        nextIssue: String
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.sourceOfTruth = sourceOfTruth
        self.macOS = macOS
        self.iPhone = iPhone
        self.iPad = iPad
        self.nextIssue = nextIssue
    }
}

public struct AppleMilestone: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let summary: String
    public let issue: String
    public let phase: AppleDeliveryPhase

    public init(id: String, title: String, summary: String, issue: String, phase: AppleDeliveryPhase) {
        self.id = id
        self.title = title
        self.summary = summary
        self.issue = issue
        self.phase = phase
    }
}

public struct AppleFoundationSnapshot: Hashable, Sendable {
    public let title: String
    public let summary: String
    public let statusLine: String
    public let lanes: [AppleCapabilityLane]
    public let milestones: [AppleMilestone]
    public let safetyNotes: [String]

    public init(
        title: String,
        summary: String,
        statusLine: String,
        lanes: [AppleCapabilityLane],
        milestones: [AppleMilestone],
        safetyNotes: [String]
    ) {
        self.title = title
        self.summary = summary
        self.statusLine = statusLine
        self.lanes = lanes
        self.milestones = milestones
        self.safetyNotes = safetyNotes
    }
}

public extension AppleFoundationSnapshot {
    static let live = AppleFoundationSnapshot(
        title: "Family Apple MediFlow",
        summary: "Mac come home-base autorevole, shell distinte per macOS e mobile, convergenza disciplinata tramite contratti condivisi.",
        statusLine: "Questa build apre il package condiviso e il primo shell mobile. Pairing harden, write remoto e runtime packaged restano nei slice successivi.",
        lanes: [
            AppleCapabilityLane(
                id: "home-base",
                title: "Home-base e trasporto",
                summary: "Il backend locale e `/api/v1/network/*` read-only esistono gia. Il runtime packaged e l'harden LAN vengono dopo questa build.",
                sourceOfTruth: "ADR 0034, ADR 0038, ADR 0047",
                macOS: ApplePlatformStatus(phase: .foundation, detail: "Nuovo window condiviso e foundation build pronta"),
                iPhone: ApplePlatformStatus(phase: .next, detail: "Shell mobile pronta; pairing dedicato in attesa"),
                iPad: ApplePlatformStatus(phase: .next, detail: "Layout split pronto; trasporto paired in attesa"),
                nextIssue: "WUL-189"
            ),
            AppleCapabilityLane(
                id: "shared-contract",
                title: "Contratto condiviso",
                summary: "La convergenza resta guidata da `/api/v1/*` e dall'estensione progressiva di `/api/v1/network/*`, mai da accesso diretto a SQLite.",
                sourceOfTruth: "ADR 0005, ADR 0010, ADR 0047",
                macOS: ApplePlatformStatus(phase: .shipping, detail: "Shell storica gia basata su `/api/v1`"),
                iPhone: ApplePlatformStatus(phase: .foundation, detail: "Shell agganciato al package condiviso"),
                iPad: ApplePlatformStatus(phase: .foundation, detail: "Stesso foundation package, layout dedicato"),
                nextIssue: "WUL-190"
            ),
            AppleCapabilityLane(
                id: "clinical-modules",
                title: "Moduli clinici core",
                summary: "Pazienti, diario, terapie, controlli, osservazioni, farmaci ed esenzioni devono migrare modulo-per-modulo senza fork logici.",
                sourceOfTruth: "PLANS sezione 5, docs/parity-matrix.md",
                macOS: ApplePlatformStatus(phase: .next, detail: "Rebuild del shell clinico nel nuovo assetto"),
                iPhone: ApplePlatformStatus(phase: .blocked, detail: "Read/write non-AI dipendono da boundary paired"),
                iPad: ApplePlatformStatus(phase: .blocked, detail: "Parita ampia dopo write boundary e cache"),
                nextIssue: "WUL-193"
            ),
            AppleCapabilityLane(
                id: "runtime",
                title: "Runtime locale e AI plane",
                summary: "La app macOS dovra bootstrapare backend, TLS, Ollama e componenti Docker. L'AI mobile resta separata dal data plane clinico.",
                sourceOfTruth: "ADR 0037, ADR 0047",
                macOS: ApplePlatformStatus(phase: .next, detail: "Packaged home-base da costruire"),
                iPhone: ApplePlatformStatus(phase: .blocked, detail: "Nessun comando AI remoto in questa wave"),
                iPad: ApplePlatformStatus(phase: .blocked, detail: "Consultazione output solo dopo boundary esplicito"),
                nextIssue: "WUL-192"
            )
        ],
        milestones: [
            AppleMilestone(
                id: "foundation",
                title: "Foundation package + shell mobile",
                summary: "Questa build introduce il modulo SwiftUI condiviso e il target app mobile universale.",
                issue: "WUL-191",
                phase: .foundation
            ),
            AppleMilestone(
                id: "transport",
                title: "Pairing harden su LAN fidata",
                summary: "Discovery, trasporto e credenziali paired senza riuso del `local-api-token`.",
                issue: "WUL-189",
                phase: .next
            ),
            AppleMilestone(
                id: "writes",
                title: "Write boundary reviewable",
                summary: "Estensione di `/api/v1/network/*` con primi write path non-AI e stessa semantica di audit/conflitto del core.",
                issue: "WUL-190",
                phase: .next
            ),
            AppleMilestone(
                id: "runtime",
                title: "macOS packaged runtime host",
                summary: "Avvio nativo di backend locale, TLS, Ollama e Docker senza passare dal terminale.",
                issue: "WUL-192",
                phase: .next
            ),
            AppleMilestone(
                id: "parity",
                title: "Parita Apple-wide non-AI",
                summary: "Cache cifrata, stati paired online/offline e matrice parity su macOS, iPhone e iPad.",
                issue: "WUL-193 / WUL-194",
                phase: .next
            )
        ],
        safetyNotes: [
            "SQLite resta autorevole solo sul Mac home-base.",
            "iPhone e iPad non usano `local-api-token` e non leggono il DB locale direttamente.",
            "La prima wave mobile resta non-AI e paired-first.",
            "La parita resta comportamentale e contrattuale, non una UI unica cross-platform."
        ]
    )
}
