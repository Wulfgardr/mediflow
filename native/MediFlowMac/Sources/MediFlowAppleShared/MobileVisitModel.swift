import Combine
import CryptoKit
import Foundation
import MediFlowCore

@MainActor
final class MobileVisitModel: ObservableObject {
    @Published private(set) var dossiers: [MobileVisitDossier] = []
    @Published private(set) var retainedNoteIDs: [UUID] = []
    @Published private(set) var retainedNotes: [MobileVisitRetainedNote] = []
    @Published private(set) var selectedNote: MobileVisitRetainedNote?
    @Published private(set) var selected: MobileVisitDossier?
    @Published private(set) var noteText = ""
    @Published private(set) var errorMessage: String?
    @Published private(set) var statusMessage: String?
    @Published private(set) var isBusy = false
    @Published private(set) var isUnlocked = false
    @Published private(set) var onlineReview: MobileVisitDossier?
    private let store: MobileVisitStore
    private let unlocker: any MobileVisitUnlocking
    private let now: () -> Date
    private var key: SymmetricKey?
    private var records: [MobileVisitRecord] = []
    private var unavailableDossierIDs: Set<UUID> = []
    private var epoch = UUID()
    private var selectedID: UUID?
    private var reviewID: UUID?
    private var reviewedRevision: Int?

    init(store: MobileVisitStore, unlocker: any MobileVisitUnlocking, now: @escaping () -> Date = Date.init) {
        self.store = store
        self.unlocker = unlocker
        self.now = now
    }

    func lock() {
        epoch = UUID()
        unlocker.invalidate()
        key = nil
        records = []
        unavailableDossierIDs = []
        dossiers = []
        retainedNoteIDs = []
        retainedNotes = []
        selectedNote = nil
        selected = nil
        selectedID = nil
        noteText = ""
        onlineReview = nil
        reviewID = nil
        reviewedRevision = nil
        isUnlocked = false
        isBusy = false
        errorMessage = nil
        statusMessage = nil
    }

    func unlock() async {
        guard !isBusy else { return }
        let ticket = epoch
        isBusy = true
        do {
            let key = try await unlocker.unlock(createIfMissing: false)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            records = try store.read(key: key)
            self.key = key
            isUnlocked = true
            errorMessage = nil
            refreshPresentation()
        } catch { if ticket == epoch { show(error) } }
        if ticket == epoch { isBusy = false }
    }

    func prepare(patientID: String, online: any MobileVisitOnlineReading, consent: Bool) async {
        guard consent, !isBusy else { return }
        let ticket = epoch
        isBusy = true
        do {
            let dossier = try await online.acquire(patientID: patientID, forImport: false)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            guard dossier.context.patientID == patientID, dossier.isReadable(at: now(), lastOpenedAt: dossier.acquiredAt) else {
                throw MobileVisitError.invalidContext
            }
            let localKey: SymmetricKey
            if let key { localKey = key }
            else { localKey = try await unlocker.unlock(createIfMissing: !store.exists) }
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            var saved = try store.read(key: localKey)
            if let index = saved.firstIndex(where: { $0.dossier.context == dossier.context }) {
                let old = saved[index]
                guard old.note.text.isEmpty else { throw MobileVisitError.changed }
                let replacement = MobileVisitDossier(id: old.id, context: dossier.context, patientName: dossier.patientName,
                    acquiredAt: dossier.acquiredAt, expiresAt: dossier.expiresAt, sections: dossier.sections, omissions: dossier.omissions)
                saved[index] = MobileVisitRecord(dossier: replacement, note: old.note, preparationLoginDigest: online.loginDigest, lastOpenedAt: now(), registrations: old.registrations)
                selectedID = old.id
            } else {
                let note = MobileVisitNote(id: UUID(), context: dossier.context, text: "", revision: 0, updatedAt: now(), patientLabel: dossier.patientName)
                saved.append(MobileVisitRecord(dossier: dossier, note: note, preparationLoginDigest: online.loginDigest, lastOpenedAt: now()))
                selectedID = dossier.id
            }
            try store.write(saved, key: localKey)
            records = saved
            key = localKey
            isUnlocked = true
            errorMessage = nil
            refreshPresentation()
            statusMessage = "Dossier acquisito. Copia storica, valida fino alla scadenza indicata."
        } catch { if ticket == epoch { show(error) } }
        if ticket == epoch { isBusy = false }
    }

    func open(_ id: UUID) {
        do {
            guard let key, let index = records.firstIndex(where: { $0.id == id }) else { throw MobileVisitError.locked }
            selectedID = id
            onlineReview = nil
            reviewID = nil
            errorMessage = nil
            if records[index].dossier.isReadable(at: now(), lastOpenedAt: records[index].lastOpenedAt) {
                var saved = records
                saved[index].lastOpenedAt = now()
                do {
                    try store.write(saved, key: key)
                    records = saved
                    unavailableDossierIDs.remove(id)
                } catch {
                    unavailableDossierIDs.insert(id)
                    refreshPresentation()
                    throw error
                }
            }
            refreshPresentation()
        } catch { show(error) }
    }

    func saveNote(_ text: String) {
        do {
            guard text.count <= 100_000 else { throw MobileVisitError.tooLarge }
            guard let key, let selectedID, let index = records.firstIndex(where: { $0.id == selectedID }) else {
                throw MobileVisitError.locked
            }
            guard text != records[index].note.text else { return }
            var saved = records
            saved[index].note.text = text
            saved[index].note.revision += 1
            saved[index].note.updatedAt = now()
            try store.write(saved, key: key)
            records = saved
            refreshPresentation()
            noteText = text
            onlineReview = nil
            reviewID = nil
            statusMessage = "Appunto salvato cifrato sul dispositivo. Non registrato in cartella."
            errorMessage = nil
        } catch { show(error) }
    }

    func checkExpiry() { refreshPresentation() }

    func reviewOnline(id: UUID, freshLogin: (MobileVisitContext) async throws -> any MobileVisitOnlineReading) async {
        guard !isBusy, key != nil, let record = records.first(where: { $0.id == id }) else { return }
        let ticket = epoch
        onlineReview = nil
        reviewID = nil
        isBusy = true
        do {
            let online = try await freshLogin(record.dossier.context)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            guard online.loginDigest != record.preparationLoginDigest else { throw MobileVisitError.denied }
            let latest = try await online.acquire(patientID: record.dossier.context.patientID, forImport: true)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            guard latest.context == record.dossier.context,
                  latest.isReadable(at: now(), lastOpenedAt: latest.acquiredAt) else { throw MobileVisitError.invalidContext }
            onlineReview = latest
            errorMessage = nil
            reviewID = id
            reviewedRevision = record.note.revision
            noteText = record.note.text
            statusMessage = latest.revisions == record.dossier.revisions
                ? "Fonti rilette online. Rivedi l’appunto prima di importarlo."
                : "Fonti cambiate: confronta il dossier aggiornato e rivedi l’appunto prima di importarlo."
        } catch { if ticket == epoch { show(error) } }
        if ticket == epoch { isBusy = false }
    }

    func importReviewedNote(confirmed: Bool, freshLogin: (MobileVisitContext) async throws -> any MobileVisitOnlineReading,
                            insertIntoOrdinaryComposer: (MobileVisitImport) throws -> Void) async {
        guard confirmed, !isBusy, let reviewed = onlineReview, let reviewID,
              let record = records.first(where: { $0.id == reviewID }), record.note.revision == reviewedRevision else { return }
        let ticket = epoch
        isBusy = true
        do {
            let online = try await freshLogin(record.dossier.context)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            guard online.loginDigest != record.preparationLoginDigest else { throw MobileVisitError.denied }
            let latest = try await online.acquire(patientID: record.dossier.context.patientID, forImport: true)
            guard ticket == epoch, !Task.isCancelled else { if ticket == epoch { isBusy = false }; return }
            guard latest.context == record.dossier.context else { throw MobileVisitError.invalidContext }
            guard latest.isReadable(at: now(), lastOpenedAt: latest.acquiredAt), latest.revisions == reviewed.revisions else {
                throw MobileVisitError.changed
            }
            let request = try prepareImport(recordID: reviewID)
            try insertIntoOrdinaryComposer(request)
            errorMessage = nil
            statusMessage = "Appunto importato per revisione nel diario. La copia locale resta conservata; registra con il comando ordinario."
            onlineReview = nil
            self.reviewID = nil
            noteText = ""
            selectedID = nil
            selected = nil
            selectedNote = nil
        } catch { if ticket == epoch { show(error) } }
        if ticket == epoch { isBusy = false }
    }

    func preparationDigest(for id: UUID) throws -> Data {
        guard key != nil, let record = records.first(where: { $0.id == id }) else { throw MobileVisitError.locked }
        return record.preparationLoginDigest
    }

    func context(for id: UUID) throws -> MobileVisitContext {
        guard key != nil, let record = records.first(where: { $0.id == id }) else { throw MobileVisitError.locked }
        return record.note.context
    }

    func prepareImport(recordID: UUID) throws -> MobileVisitImport {
        guard let record = records.first(where: { $0.id == recordID }), !record.note.text.isEmpty else { throw MobileVisitError.locked }
        let registrations = record.registrations ?? []
        guard !registrations.contains(where: { $0.payload != nil && $0.phase != .registered }) else { throw MobileVisitError.pendingRegistration }
        guard !registrations.contains(where: { $0.noteRevision == record.note.revision && $0.phase == .registered }) else {
            throw MobileVisitError.alreadyRegistered
        }
        let registration = registrations.first(where: { $0.noteRevision == record.note.revision })
            ?? MobileVisitRegistration(entryID: UUID().uuidString, noteRevision: record.note.revision, phase: .draft)
        if !registrations.contains(where: { $0.entryID == registration.entryID }) {
            try updateRecord(recordID) { $0.registrations = registrations + [registration] }
        }
        return MobileVisitImport(recordID: recordID, noteID: record.note.id, revision: record.note.revision,
            entryID: registration.entryID, context: record.note.context, text: record.note.text)
    }

    func registration(for binding: MobileVisitImport) throws -> MobileVisitRegistration {
        guard key != nil, let record = records.first(where: { $0.id == binding.recordID }), record.note.id == binding.noteID,
              record.note.context == binding.context,
              let registration = record.registrations?.first(where: { $0.entryID == binding.entryID && $0.noteRevision == binding.revision }) else {
            throw MobileVisitError.invalidContext
        }
        return registration
    }

    func beginSubmission(_ binding: MobileVisitImport, candidate: HomeBaseEntryCreatePayload, composerDigest: Data) throws -> HomeBaseEntryCreatePayload {
        let registration = try registration(for: binding)
        guard registration.phase == .draft, candidate.id == binding.entryID,
              (registration.payload != nil || records.first(where: { $0.id == binding.recordID })?.note.revision == binding.revision) else { throw MobileVisitError.changed }
        guard registration.composerDigest == nil || registration.composerDigest == composerDigest else { throw MobileVisitError.changed }
        let frozen = registration.payload ?? MobileVisitEntryPayload(candidate)
        try updateRegistration(binding) {
            $0.payload = frozen
            $0.composerDigest = composerDigest
            $0.phase = .uncertain
        }
        return frozen.payload
    }

    func acknowledge(_ binding: MobileVisitImport, id: String, version: Int?) throws {
        guard id == binding.entryID, let version, version > 0 else { throw MobileVisitError.corrupt }
        try updateRegistration(binding) { $0.acknowledgedVersion = version }
    }

    func confirm(_ binding: MobileVisitImport, entry: HomeBaseEntrySummary) throws {
        let registration = try registration(for: binding)
        guard let payload = registration.payload, payload.matches(entry, patientID: binding.context.patientID),
              registration.acknowledgedVersion == nil || entry.version == registration.acknowledgedVersion else {
            throw MobileVisitError.changed
        }
        try updateRegistration(binding) {
            $0.phase = .registered
            $0.acknowledgedVersion = entry.version
            $0.confirmedAt = now()
        }
        statusMessage = "Registrata in cartella: versione \(entry.version), confermata con rilettura online. L’appunto locale resta conservato."
    }

    func allowExplicitRetry(_ binding: MobileVisitImport) throws {
        let registration = try registration(for: binding)
        guard registration.phase != .registered, registration.payload != nil else { throw MobileVisitError.changed }
        guard registration.phase != .draft else { return }
        try updateRegistration(binding) { $0.phase = .draft }
    }

    func unresolvedImport(recordID: UUID) throws -> MobileVisitImport {
        guard let record = records.first(where: { $0.id == recordID }),
              let registration = record.registrations?.first(where: { $0.phase == .uncertain || ($0.phase == .draft && $0.payload != nil) }) else {
            throw MobileVisitError.changed
        }
        return MobileVisitImport(recordID: recordID, noteID: record.note.id, revision: registration.noteRevision,
            entryID: registration.entryID, context: record.note.context, text: record.note.text)
    }

    private func updateRegistration(_ binding: MobileVisitImport, _ change: (inout MobileVisitRegistration) throws -> Void) throws {
        _ = try registration(for: binding)
        try updateRecord(binding.recordID) { record in
            guard let index = record.registrations?.firstIndex(where: { $0.entryID == binding.entryID }) else { throw MobileVisitError.corrupt }
            try change(&record.registrations![index])
        }
    }

    private func updateRecord(_ id: UUID, _ change: (inout MobileVisitRecord) throws -> Void) throws {
        guard let key, let index = records.firstIndex(where: { $0.id == id }) else { throw MobileVisitError.locked }
        var saved = records
        try change(&saved[index])
        try store.write(saved, key: key)
        records = saved
        refreshPresentation()
    }

    private func refreshPresentation() {
        let instant = now()
        dossiers = records.filter { !unavailableDossierIDs.contains($0.id) && $0.dossier.isReadable(at: instant, lastOpenedAt: $0.lastOpenedAt) }.map(\.dossier)
        retainedNoteIDs = records.filter { !$0.note.text.isEmpty }.map(\.id)
        retainedNotes = records.map { record in
            MobileVisitRetainedNote(id: record.id, label: record.note.patientLabel ?? record.note.context.patientID,
                context: record.note.context, revision: record.note.revision, updatedAt: record.note.updatedAt,
                dossierExpired: !record.dossier.isReadable(at: instant, lastOpenedAt: record.lastOpenedAt),
                registrations: record.registrations ?? [])
        }
        selectedNote = retainedNotes.first(where: { $0.id == selectedID })
        if let selectedID, let record = records.first(where: { $0.id == selectedID }) {
            selected = !unavailableDossierIDs.contains(record.id) && record.dossier.isReadable(at: instant, lastOpenedAt: record.lastOpenedAt) ? record.dossier : nil
            if onlineReview == nil { noteText = record.note.text }
        } else { selected = nil; if onlineReview == nil { noteText = "" } }
        if let onlineReview, !onlineReview.isReadable(at: instant, lastOpenedAt: onlineReview.acquiredAt) {
            self.onlineReview = nil
            reviewID = nil
            if selectedNote == nil { noteText = "" }
        }
    }

    private func show(_ error: Error) {
        errorMessage = (error as? MobileVisitError ?? .denied).localizedDescription
    }
}
