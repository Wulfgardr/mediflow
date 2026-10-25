import Foundation
import CryptoKit

struct MobileVisitContext: Codable, Equatable, Sendable {
    let serverURL: String
    let tlsPin: String
    let pairedClientID: String
    let pairedTokenDigest: Data
    let archiveGeneration: String
    let operatorID: String
    let scopeID: String
    let patientID: String

    var isValid: Bool {
        URL(string: serverURL)?.scheme == "https" && URL(string: serverURL)?.host != nil
            && !tlsPin.isEmpty && !pairedClientID.isEmpty && pairedTokenDigest.count == 32
            && !archiveGeneration.isEmpty && !operatorID.isEmpty && !scopeID.isEmpty && !patientID.isEmpty
    }
}

struct MobileVisitSection: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let source: String
    let rows: [Row]
    let limitation: String?

    struct Row: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let version: Int
        let text: String
    }
}

struct MobileVisitDossier: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let context: MobileVisitContext
    let patientName: String
    let acquiredAt: Date
    let expiresAt: Date
    let sections: [MobileVisitSection]
    let omissions: [String]

    var revisions: [String: [String: Int]] {
        Dictionary(uniqueKeysWithValues: sections.map { section in
            (section.id, Dictionary(uniqueKeysWithValues: section.rows.map { ($0.id, $0.version) }))
        })
    }

    func isReadable(at now: Date, lastOpenedAt: Date) -> Bool {
        context.isValid && !patientName.isEmpty
            && Set(sections.map(\.id)).count == sections.count
            && sections.allSatisfy { Set($0.rows.map(\.id)).count == $0.rows.count && $0.rows.allSatisfy { $0.version > 0 } }
            && acquiredAt.timeIntervalSinceReferenceDate.isFinite
            && expiresAt.timeIntervalSinceReferenceDate.isFinite
            && now >= acquiredAt && now >= lastOpenedAt && now < expiresAt
            && expiresAt > acquiredAt && expiresAt.timeIntervalSince(acquiredAt) <= 86_400
    }
}

struct MobileVisitNote: Codable, Equatable, Sendable {
    let id: UUID
    let context: MobileVisitContext
    var text: String
    var revision: Int
    var updatedAt: Date
}

struct MobileVisitRecord: Codable, Equatable, Identifiable, Sendable {
    var dossier: MobileVisitDossier
    var note: MobileVisitNote
    let preparationLoginDigest: Data
    var lastOpenedAt: Date
    var id: UUID { dossier.id }
}

enum MobileVisitError: Error, LocalizedError, Equatable {
    case denied, invalidContext, expired, corrupt, storage, locked, changed, occupied, tooLarge

    var errorDescription: String? {
        switch self {
        case .denied: return "Accesso negato. Verifica autenticazione e autorizzazioni."
        case .invalidContext: return "Archivio, paziente o contesto non corrispondenti. Riaccedi online."
        case .expired: return "Dossier scaduto o orologio incoerente. L’appunto resta cifrato: riaccedi online per recuperarlo."
        case .corrupt: return "Archivio locale non leggibile. I file conservati non vengono sostituiti."
        case .storage: return "Salvataggio cifrato non riuscito. La modifica non è stata accettata."
        case .locked: return "Sblocca il dossier con l’autenticazione del dispositivo."
        case .changed: return "Le fonti sono cambiate. Rileggi il dossier aggiornato prima di importare l’appunto."
        case .occupied: return "Il compositore contiene già una bozza. Conservala prima di importare l’appunto."
        case .tooLarge: return "Appunto troppo lungo (massimo 100.000 caratteri)."
        }
    }
}
