import Combine
import CryptoKit
import Foundation

@MainActor
final class MobileVisitModel: ObservableObject {
    @Published private(set) var dossiers: [MobileVisitDossier] = []
    @Published private(set) var retainedNoteIDs: [UUID] = []
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
        dossiers = []
        retainedNoteIDs = []
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
                saved[index] = MobileVisitRecord(dossier: replacement, note: old.note, preparationLoginDigest: online.loginDigest, lastOpenedAt: now())
                selectedID = old.id
            } else {
                let note = MobileVisitNote(id: UUID(), context: dossier.context, text: "", revision: 0, updatedAt: now())
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
            guard records[index].dossier.isReadable(at: now(), lastOpenedAt: records[index].lastOpenedAt) else {
                throw MobileVisitError.expired
            }
            var saved = records
            saved[index].lastOpenedAt = now()
            try store.write(saved, key: key)
            records = saved
            selectedID = id
            errorMessage = nil
            onlineReview = nil
            reviewID = nil
            refreshPresentation()
        } catch { show(error) }
    }

    func saveNote(_ text: String) {
        do {
            guard text.count <= 100_000 else { throw MobileVisitError.tooLarge }
            guard let key, let selectedID, let index = records.firstIndex(where: { $0.id == selectedID }) else {
                throw MobileVisitError.locked
            }
            guard records[index].dossier.isReadable(at: now(), lastOpenedAt: records[index].lastOpenedAt) else {
                refreshPresentation()
                throw MobileVisitError.expired
            }
            var saved = records
            saved[index].note.text = text
            saved[index].note.revision += 1
            saved[index].note.updatedAt = now()
            saved[index].lastOpenedAt = now()
            try store.write(saved, key: key)
            records = saved
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
                            insertIntoOrdinaryComposer: (MobileVisitContext, String) throws -> Void) async {
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
            try insertIntoOrdinaryComposer(latest.context, record.note.text)
            errorMessage = nil
            statusMessage = "Appunto importato per revisione nel diario. La copia locale resta conservata; registra con il comando ordinario."
            onlineReview = nil
            self.reviewID = nil
            noteText = ""
            selectedID = nil
            selected = nil
        } catch { if ticket == epoch { show(error) } }
        if ticket == epoch { isBusy = false }
    }

    private func refreshPresentation() {
        let instant = now()
        dossiers = records.filter { $0.dossier.isReadable(at: instant, lastOpenedAt: $0.lastOpenedAt) }.map(\.dossier)
        retainedNoteIDs = records.filter { !$0.note.text.isEmpty }.map(\.id)
        if let selectedID, let record = records.first(where: { $0.id == selectedID }),
           record.dossier.isReadable(at: instant, lastOpenedAt: record.lastOpenedAt) {
            selected = record.dossier
            if onlineReview == nil { noteText = record.note.text }
        } else {
            selected = nil
            if onlineReview == nil { noteText = "" }
        }
        if let onlineReview, !onlineReview.isReadable(at: instant, lastOpenedAt: onlineReview.acquiredAt) {
            self.onlineReview = nil
            reviewID = nil
            noteText = ""
        }
    }

    private func show(_ error: Error) {
        errorMessage = (error as? MobileVisitError ?? .denied).localizedDescription
    }
}
