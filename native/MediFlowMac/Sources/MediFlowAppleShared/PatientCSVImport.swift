import Foundation
import Combine

struct PatientCSVRow: Identifiable, Equatable {
    let id: Int
    let line: Int
    let cells: [String]
    var issues: [String]
    var taxCode: String? { cells.count > 2 ? PatientCSV.normalizedTaxCode(cells[2]) : nil }
    var eligible: Bool { issues.isEmpty }
}

enum PatientCSV {
    static let headers = ["nome", "cognome", "codice_fiscale", "data_nascita", "indirizzo", "telefono"]
    static let template = "\u{FEFF}" + headers.joined(separator: ";") + "\r\n"
    static let maximumBytes = 2 * 1024 * 1024

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    static func normalizedTaxCode(_ value: String) -> String? {
        let candidate = value.trimmingCharacters(in: CharacterSet(charactersIn: " "))
        guard candidate.utf8.count == 16,
              candidate.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }) else { return nil }
        return candidate.uppercased()
    }

    static func birthDate(_ value: String) -> Date? {
        guard value.utf8.count == 10, value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, parts[0] > 0 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard let date = calendar.date(from: components),
              calendar.dateComponents([.year, .month, .day], from: date) == components else { return nil }
        return date
    }

    static func parse(_ bytes: Data) throws -> [PatientCSVRow] {
        guard bytes.count <= maximumBytes else { throw Failure("Il file supera 2 MiB.") }
        guard var text = String(data: bytes, encoding: .utf8) else { throw Failure("Il file non è un CSV UTF-8 valido.") }
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        let input = Array(text.utf16)
        var records: [(line: Int, cells: [String])] = []
        var cells: [String] = []
        var field: [UInt16] = []
        enum Mode { case start, bare, quoted, closed }
        var mode = Mode.start
        var line = 1, startLine = 1, recordLength = 0, index = 0
        var touched = false
        func append(_ char: UInt16) throws {
            guard field.count < 1024 else { throw Failure("Una cella supera il limite consentito.") }
            field.append(char)
        }
        func endField() throws {
            guard cells.count < 6 else { throw Failure("Troppe colonne: usa le sei colonne del modello.") }
            cells.append(String(decoding: field, as: UTF16.self))
            field = []
            mode = .start
        }
        func endRecord() throws {
            if touched || !cells.isEmpty || !field.isEmpty {
                try endField()
                guard records.count < 501 else { throw Failure("Il file supera 500 righe di dati.") }
                records.append((startLine, cells))
            }
            cells = []; field = []; mode = .start; touched = false; recordLength = 0
        }
        while index < input.count {
            let char = input[index]
            if mode == .quoted || (char != 13 && char != 10) {
                recordLength += 1
                guard recordLength <= 4096 else { throw Failure("Una riga supera il limite consentito.") }
            }
            if char == 13 || char == 10 {
                let crlf = char == 13 && index + 1 < input.count && input[index + 1] == 10
                if mode == .quoted {
                    try append(char)
                    if crlf {
                        recordLength += 1
                        guard recordLength <= 4096 else { throw Failure("Una riga supera il limite consentito.") }
                        try append(10)
                    }
                } else { try endRecord() }
                if crlf { index += 1 }
                line += 1
                if mode != .quoted { startLine = line }
                index += 1
                continue
            }
            touched = true
            switch mode {
            case .quoted:
                if char == 34 { mode = .closed } else { try append(char) }
            case .closed:
                if char == 34 { try append(34); mode = .quoted }
                else if char == 59 { try endField() }
                else { throw Failure("Dopo una chiusura di virgolette è ammesso solo il separatore o fine riga.") }
            case .start, .bare:
                if char == 59 { try endField() }
                else if char == 34 {
                    guard mode == .start else { throw Failure("Virgolette in posizione non valida.") }
                    mode = .quoted
                } else { try append(char); mode = .bare }
            }
            index += 1
        }
        guard mode != .quoted else { throw Failure("Un campo tra virgolette non è chiuso.") }
        try endRecord()
        guard let header = records.first, header.line == 1, header.cells == headers else {
            throw Failure("La prima riga deve contenere le sei colonne del modello, nello stesso ordine, separate da punto e virgola.")
        }
        let limits = [100, 100, 64, 10, 500, 80]
        var rows = records.dropFirst().enumerated().map { offset, record in
            var issues: [String] = []
            if record.cells.count != 6 { issues.append("Servono sei colonne; lascia vuote quelle opzionali.") }
            for (column, value) in record.cells.enumerated() {
                if value.utf16.count > limits[column] { issues.append("\(headers[column]): il campo supera \(limits[column]) caratteri.") }
                if value.unicodeScalars.contains(where: { scalar in
                    let code = scalar.value
                    return !(column == 4 && (code == 10 || code == 13)) && (code < 32 || (127...159).contains(code))
                }) { issues.append("\(headers[column]): caratteri di controllo non ammessi.") }
            }
            if record.cells.count == 6 {
                if record.cells[0].trimmingCharacters(in: .whitespacesAndNewlines).utf16.count < 2 { issues.append("Il nome deve contenere almeno due caratteri.") }
                if record.cells[1].trimmingCharacters(in: .whitespacesAndNewlines).utf16.count < 2 { issues.append("Il cognome deve contenere almeno due caratteri.") }
                if normalizedTaxCode(record.cells[2]) == nil { issues.append("Il codice fiscale deve contenere 16 caratteri alfanumerici ASCII.") }
                if !record.cells[3].isEmpty && birthDate(record.cells[3]) == nil { issues.append("Usa una data reale nel formato YYYY-MM-DD.") }
            }
            return PatientCSVRow(id: offset + 1, line: record.line, cells: record.cells, issues: issues)
        }
        let counts = Dictionary(grouping: rows.compactMap(\.taxCode), by: { $0 }).mapValues(\.count)
        for index in rows.indices where counts[rows[index].taxCode ?? "", default: 0] > 1 {
            rows[index].issues.append("Codice fiscale ripetuto nel file: tutte le occorrenze escluse.")
        }
        return rows
    }
}

@MainActor
final class PatientCSVImportModel: ObservableObject {
    enum Outcome: String { case excluded = "Esclusa", notSent = "Non inviata", confirmed = "Confermata", unknown = "Esito sconosciuto", observed = "Osservata nella rilettura" }
    struct Receipt: Identifiable {
        let id: Int
        let patientID: String?
        var outcome: Outcome
    }
    @Published private(set) var rows: [PatientCSVRow] = []
    @Published private(set) var receipts: [Receipt] = []
    @Published private(set) var busy = false
    @Published private(set) var notice: String?
    @Published private(set) var canConfirm = false
    let destination: String
    private let isCurrent: () -> Bool
    private let read: () async throws -> [HomeBasePatientSummary]
    private let create: (PatientCSVRow, String) async throws -> HomeBaseCreatedResource
    private let now: () -> Date
    private let didFinish: () async -> Void
    private var previewDate: Date?
    private var generation = UUID()
    private var stopped = false
    private var attempted = false
    private var invalidated = false
    var contextAvailable: Bool { !invalidated && isCurrent() }
    var eligibleCount: Int { rows.filter(\.eligible).count }
    var hasUncertainResult: Bool { receipts.contains { $0.outcome == .unknown } }
    var canReadFile: Bool { !busy && !attempted && !invalidated && isCurrent() }

    init(destination: String, isCurrent: @escaping () -> Bool,
         read: @escaping () async throws -> [HomeBasePatientSummary],
         create: @escaping (PatientCSVRow, String) async throws -> HomeBaseCreatedResource,
         now: @escaping () -> Date = Date.init,
         didFinish: @escaping () async -> Void = {}) {
        self.destination = destination; self.isCurrent = isCurrent
        self.read = read; self.create = create; self.now = now
        self.didFinish = didFinish
    }

    func load(_ bytes: Data) async {
        guard canReadFile else { return }
        generation = UUID()
        let token = generation
        canConfirm = false; rows = []; receipts = []; notice = nil; busy = true; stopped = false
        defer { busy = false }
        do {
            var parsed = try PatientCSV.parse(bytes)
            let existing = try await read()
            guard token == generation, !stopped, isCurrent() else { invalidate(); return }
            let codes = Set(existing.compactMap { PatientCSV.normalizedTaxCode($0.taxCode) })
            for index in parsed.indices where codes.contains(parsed[index].taxCode ?? "") {
                parsed[index].issues.append("Codice fiscale già presente nell’ambulatorio, anche tra le schede archiviate o nel cestino.")
            }
            rows = parsed; previewDate = now(); canConfirm = eligibleCount > 0
            notice = "Anteprima valida per 5 minuti. Nessuna scheda è stata salvata."
        } catch {
            guard token == generation, isCurrent() else { invalidate(); return }
            notice = (error as? PatientCSV.Failure)?.errorDescription ?? "Impossibile verificare le anagrafiche esistenti. Nessuna scheda è stata inviata."
        }
    }

    func cancel() {
        stopped = true; canConfirm = false
        notice = busy ? "Interruzione richiesta: attendo l’esito della riga già inviata. Le righe successive non saranno inviate." : "Importazione interrotta. Le schede confermate rimangono salvate."
    }

    func invalidate() {
        invalidated = true; stopped = true; canConfirm = false; rows = []; previewDate = nil
        generation = UUID()
        notice = "Contesto cambiato: importazione interrotta. Verifica gli esiti prima di riprovare."
    }

    func confirm(reviewed: Bool) async {
        guard reviewed, canConfirm, !busy, !attempted else { return }
        guard isCurrent(), let previewDate, now().timeIntervalSince(previewDate) < 300 else {
            canConfirm = false; notice = "Anteprima scaduta o contesto cambiato: seleziona nuovamente il file."; return
        }
        busy = true; canConfirm = false; stopped = false
        defer { busy = false }
        do {
            let existing = try await read()
            guard !stopped, isCurrent(), now().timeIntervalSince(previewDate) < 300 else { invalidate(); return }
            let codes = Set(existing.compactMap { PatientCSV.normalizedTaxCode($0.taxCode) })
            for index in rows.indices where codes.contains(rows[index].taxCode ?? "") && rows[index].eligible {
                rows[index].issues.append("Codice fiscale già presente: riga esclusa prima dell’invio.")
            }
        } catch {
            notice = "Verifica delle anagrafiche non disponibile. Nessuna riga inviata; seleziona nuovamente il file."
            return
        }
        attempted = true
        let batch = rows
        receipts = batch.map { Receipt(id: $0.id, patientID: $0.eligible ? UUID().uuidString.lowercased() : nil,
                                      outcome: $0.eligible ? .notSent : .excluded) }
        for row in batch where row.eligible {
            guard !stopped, !Task.isCancelled, isCurrent() else { cancel(); break }
            guard let index = receipts.firstIndex(where: { $0.id == row.id }), let patientID = receipts[index].patientID else { break }
            receipts[index].outcome = .unknown
            do {
                let result = try await create(row, patientID)
                guard result.id == patientID else { notice = "Risposta inattesa: verifica l’identificativo prima di riprovare."; break }
                receipts[index].outcome = .confirmed
            } catch {
                notice = "Esito sconosciuto: la scheda potrebbe essere salvata. Non ripetere l’importazione; verifica l’identificativo sull’home-base."
                break
            }
        }
        rows = []
        if !hasUncertainResult {
            let confirmed = receipts.filter { $0.outcome == .confirmed }.count
            let remaining = receipts.filter { $0.outcome == .notSent }.count
            notice = remaining == 0 ? "Invii conclusi: \(confirmed) confermate. Controlla anche le righe escluse."
                : "Importazione parziale: \(confirmed) confermate, \(remaining) non inviate."
        }
        await didFinish()
    }

    func reconcile() async {
        guard !busy, hasUncertainResult, isCurrent(), !invalidated else { return }
        busy = true
        defer { busy = false }
        do {
            let existing = try await read()
            guard isCurrent(), !invalidated else { invalidate(); return }
            let ids = Set(existing.map(\.id))
            for index in receipts.indices where receipts[index].outcome == .unknown {
                if let id = receipts[index].patientID, ids.contains(id) { receipts[index].outcome = .observed }
            }
            notice = "Rilettura conclusa. Una scheda non trovata resta di esito sconosciuto; non dimostra un annullamento."
        } catch { notice = "Verifica non disponibile. Gli esiti sconosciuti restano da verificare; non ripetere l’importazione." }
    }
}
