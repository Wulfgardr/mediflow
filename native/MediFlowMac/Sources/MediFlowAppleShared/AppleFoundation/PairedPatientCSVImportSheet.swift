import SwiftUI
import UniformTypeIdentifiers

private struct PatientCSVTemplateDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }
    init() {}
    init(configuration: ReadConfiguration) throws {}
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(PatientCSV.template.utf8))
    }
}

struct PairedPatientCSVImportSheet: View {
    @ObservedObject var model: PatientCSVImportModel
    let startNew: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pickingFile = false
    @State private var exportingTemplate = false
    @State private var reviewed = false
    @State private var fileError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Aggiungi più pazienti da un file CSV. Controlla l’anteprima prima di confermare.")
                        .fixedSize(horizontal: false, vertical: true)
                    LabeledContent("Destinazione", value: model.destination)
                    DisclosureGroup("Formato e limiti") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("UTF-8, separatore punto e virgola, massimo 2 MiB e 500 righe. Usa le sei colonne del modello nello stesso ordine.")
                            Text(PatientCSV.headers.joined(separator: ";"))
                                .font(.caption.monospaced()).textSelection(.enabled)
                            Text("Nome, cognome e codice fiscale sono obbligatori. Data di nascita facoltativa nel formato YYYY-MM-DD; indirizzo e telefono facoltativi. I campi tra virgolette possono contenere il separatore; solo l’indirizzo può contenere righe a capo.")
                            Text("Le righe vengono salvate una alla volta. Le schede confermate rimangono presenti anche dopo un’interruzione. Il file viene letto sul dispositivo; i campi protetti vengono cifrati prima dell’invio all’home-base.")
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    ViewThatFits(in: .horizontal) {
                        HStack { fileActions }
                        VStack(alignment: .leading, spacing: 10) { fileActions }
                    }
                    if let fileError { Text(fileError).foregroundStyle(LumePalette.critical) }
                    if let notice = model.notice {
                        Text(notice).fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("patient-csv-notice")
                    }
                    if model.busy { ProgressView("Operazione in corso…") }
                    if !model.rows.isEmpty {
                        Text("\(model.eligibleCount) da aggiungere · \(model.rows.count - model.eligibleCount) escluse · \(model.rows.count) righe totali")
                            .font(.headline).accessibilityIdentifier("patient-csv-preview-count")
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(model.rows) { row in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Riga \(row.id) · linea \(row.line) · \(row.eligible ? "Da aggiungere" : "Esclusa")").font(.headline)
                                    ForEach(Array(row.cells.enumerated()), id: \.offset) { column, value in
                                        LabeledContent(PatientCSV.headers[column]) {
                                            Text(value.isEmpty ? "Assente" : value).textSelection(.enabled)
                                                .privacySensitive().fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                    ForEach(Array(row.issues.enumerated()), id: \.offset) { _, issue in
                                        Text(issue).foregroundStyle(LumePalette.critical)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    Divider()
                                }.accessibilityIdentifier("patient-csv-row-\(row.id)")
                            }
                        }
                        Toggle("Ho controllato l’anteprima e confermo le righe da aggiungere.", isOn: $reviewed)
                            .disabled(!model.canConfirm || model.busy)
                            .accessibilityIdentifier("patient-csv-reviewed")
                        Button("Conferma e aggiungi \(model.eligibleCount) pazienti") {
                            Task { await model.confirm(reviewed: reviewed) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!reviewed || !model.canConfirm || model.busy)
                        .accessibilityIdentifier("patient-csv-confirm")
                    }
                    if !model.receipts.isEmpty && model.contextAvailable {
                        Text("Esiti per riga").font(.title2)
                        Text("\(model.receipts.filter { $0.outcome == .confirmed }.count) confermate · \(model.receipts.filter { $0.outcome == .unknown }.count) sconosciute · \(model.receipts.filter { $0.outcome == .notSent }.count) non inviate · \(model.receipts.filter { $0.outcome == .excluded }.count) escluse · \(model.receipts.filter { $0.outcome == .observed }.count) osservate nella rilettura")
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("patient-csv-receipt-count")
                        ForEach(model.receipts) { receipt in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Riga \(receipt.id): \(receipt.outcome.rawValue)").font(.headline)
                                if let id = receipt.patientID {
                                    Text(id).font(.caption.monospaced()).textSelection(.enabled)
                                }
                            }
                        }
                        if model.hasUncertainResult {
                            Button("Verifica esiti sconosciuti") { Task { await model.reconcile() } }
                                .disabled(model.busy).accessibilityIdentifier("patient-csv-reconcile")
                        }
                        Text("Il promemoria resta solo in memoria in questa finestra. Prima di chiudere l’app, annota gli identificativi ancora da verificare. La rilettura non ripete alcuna scrittura.")
                            .font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                    if !model.busy && !model.hasUncertainResult && !model.canReadFile {
                        Button("Nuova importazione") { reviewed = false; fileError = nil; startNew() }
                    }
                }
                .padding(20)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Importa pazienti da CSV")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.busy ? "Interrompi" : "Chiudi") {
                        model.cancel()
                        if !model.busy { dismiss() }
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 620, idealWidth: 800, minHeight: 480, idealHeight: 700)
        #endif
        .interactiveDismissDisabled(model.busy)
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.commaSeparatedText], allowsMultipleSelection: false) { result in
            reviewed = false; fileError = nil
            do {
                guard let url = try result.get().first else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                var bytes = Data()
                while bytes.count <= PatientCSV.maximumBytes {
                    let chunk = try handle.read(upToCount: min(64 * 1024, PatientCSV.maximumBytes + 1 - bytes.count)) ?? Data()
                    if chunk.isEmpty { break }
                    bytes.append(chunk)
                }
                Task { await model.load(bytes) }
            } catch { fileError = "Impossibile leggere il file selezionato. Nessuna riga inviata." }
        }
        .fileExporter(isPresented: $exportingTemplate, document: PatientCSVTemplateDocument(),
                      contentType: .commaSeparatedText, defaultFilename: "modello-pazienti") { result in
            if case .failure = result { fileError = "Impossibile salvare il modello CSV." }
        }
        .onDisappear { model.cancel() }
    }

    @ViewBuilder
    private var fileActions: some View {
        Button("Salva modello CSV") { exportingTemplate = true }
            .disabled(model.busy)
        Button("Scegli file CSV") { pickingFile = true }
            .disabled(!model.canReadFile)
            .accessibilityIdentifier("patient-csv-choose-file")
    }
}
