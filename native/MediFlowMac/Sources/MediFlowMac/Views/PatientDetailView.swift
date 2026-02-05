// Codex: created 2026-02-01
import SwiftUI

struct PatientDetailView: View {
    let patientId: String

    @EnvironmentObject private var security: SecuritySession
    @State private var detail: PatientDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var entries: [EntrySummary] = []
    @State private var therapies: [TherapySummary] = []
    @State private var checkups: [CheckupSummary] = []
    @State private var entriesErrorMessage: String?
    @State private var therapiesErrorMessage: String?
    @State private var checkupsErrorMessage: String?
    @State private var showingNewEntry = false
    @State private var showingNewTherapy = false
    @State private var showingNewCheckup = false
    @State private var aiPrompt = ""
    @State private var aiResponse = ""
    @State private var aiErrorMessage: String?
    @State private var isAILoading = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Caricamento...")
            } else if let detail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        PatientHeaderView(detail: detail)

                        GroupBox("Anagrafica") {
                            InfoGrid(rows: [
                                InfoRow(label: "Nome", value: "\(detail.firstName) \(detail.lastName)"),
                                InfoRow(label: "Codice fiscale", value: detail.taxCode),
                                InfoRow(label: "Data di nascita", value: formatted(date: detail.birthDate)),
                                InfoRow(label: "Eta", value: ageText(from: detail.birthDate)),
                                InfoRow(label: "ADI", value: detail.isAdi == true ? "Si" : "No"),
                                InfoRow(label: "Archiviato", value: detail.isArchived == true ? "Si" : "No")
                            ])
                        }

                        GroupBox("Contatti") {
                            InfoGrid(rows: [
                                InfoRow(label: "Telefono", value: displayValue(detail.phone)),
                                InfoRow(label: "Indirizzo", value: displayValue(detail.address)),
                                InfoRow(label: "Caregiver", value: displayValue(detail.caregiver))
                            ])
                        }

                        GroupBox("Note") {
                            Text(displayNotes(detail.notes))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 4)
                        }

                        GroupBox("Diario clinico") {
                            VStack(alignment: .leading, spacing: 12) {
                                if let entriesErrorMessage {
                                    Text(entriesErrorMessage)
                                        .foregroundStyle(.red)
                                        .font(.caption)
                                } else if entries.isEmpty {
                                    Text("Nessuna voce registrata.")
                                        .foregroundStyle(.secondary)
                                } else {
                                    ForEach(entries) { entry in
                                        EntryRowView(entry: entry, content: displayValue(entry.content))
                                        if entry.id != entries.last?.id {
                                            Divider()
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 4)
                        }

                        GroupBox("Terapie") {
                            VStack(alignment: .leading, spacing: 12) {
                                if let therapiesErrorMessage {
                                    Text(therapiesErrorMessage)
                                        .foregroundStyle(.red)
                                        .font(.caption)
                                } else if therapies.isEmpty {
                                    Text("Nessuna terapia attiva.")
                                        .foregroundStyle(.secondary)
                                } else {
                                    ForEach(therapies) { therapy in
                                        TherapyRowView(therapy: therapy)
                                        if therapy.id != therapies.last?.id {
                                            Divider()
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 4)
                        }

                        GroupBox("Appuntamenti") {
                            VStack(alignment: .leading, spacing: 12) {
                                if let checkupsErrorMessage {
                                    Text(checkupsErrorMessage)
                                        .foregroundStyle(.red)
                                        .font(.caption)
                                } else if checkups.isEmpty {
                                    Text("Nessun appuntamento.")
                                        .foregroundStyle(.secondary)
                                } else {
                                    ForEach(checkups) { checkup in
                                        CheckupRowView(checkup: checkup)
                                        if checkup.id != checkups.last?.id {
                                            Divider()
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 4)
                        }

                        GroupBox("AI Clinica") {
                            VStack(alignment: .leading, spacing: 12) {
                                TextEditor(text: $aiPrompt)
                                    .frame(minHeight: 120)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2)))

                                HStack {
                                    Button(isAILoading ? "Elaborazione..." : "Genera") {
                                        Task { await runAI() }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(isAILoading || aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                                    Spacer()
                                }

                                if let aiErrorMessage {
                                    Text(aiErrorMessage)
                                        .foregroundStyle(.red)
                                        .font(.caption)
                                }

                                Text(aiResponse.isEmpty ? "Nessuna risposta" : aiResponse)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 4)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 4)
                        }

                        GroupBox("Metadati") {
                            InfoGrid(rows: [
                                InfoRow(label: "ID", value: detail.id),
                                InfoRow(label: "Creato il", value: formatted(date: detail.createdAt)),
                                InfoRow(label: "Aggiornato il", value: formatted(date: detail.updatedAt))
                            ])
                        }
                    }
                    .padding(24)
                }
            } else if let errorMessage {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Errore")
                        .font(.headline)
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "person")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Nessun dato")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(detail?.lastName ?? "Dettaglio")
        .toolbar {
            Button("Nuova voce") {
                showingNewEntry = true
            }
            Button("Nuova terapia") {
                showingNewTherapy = true
            }
            Button("Nuovo appuntamento") {
                showingNewCheckup = true
            }
        }
        .sheet(isPresented: $showingNewEntry) {
            NewEntryView(patientId: patientId) {
                Task { await loadClinicalSections() }
            }
            .environmentObject(security)
        }
        .sheet(isPresented: $showingNewTherapy) {
            NewTherapyView(patientId: patientId) {
                Task { await loadClinicalSections() }
            }
        }
        .sheet(isPresented: $showingNewCheckup) {
            NewCheckupView(patientId: patientId) {
                Task { await loadClinicalSections() }
            }
        }
        .task(id: patientId) {
            await load()
        }
    }

    private func load() async {
        if isLoading { return }
        isLoading = true
        defer { isLoading = false }

        entries = []
        therapies = []
        checkups = []
        entriesErrorMessage = nil
        therapiesErrorMessage = nil
        checkupsErrorMessage = nil

        do {
            detail = try await LocalAPIClient.shared.fetchPatient(id: patientId)
            errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                errorMessage = localError.localizedDescription
            } else {
                errorMessage = "Impossibile caricare il dettaglio."
            }
            return
        }

        await loadClinicalSections()
    }

    private func loadClinicalSections() async {
        do {
            entries = try await LocalAPIClient.shared.fetchEntries(patientId: patientId, limit: 5)
            entriesErrorMessage = nil
        } catch {
            entries = []
            entriesErrorMessage = message(for: error, fallback: "Impossibile caricare il diario clinico.")
        }

        do {
            therapies = try await LocalAPIClient.shared.fetchTherapies(patientId: patientId, limit: 5)
            therapiesErrorMessage = nil
        } catch {
            therapies = []
            therapiesErrorMessage = message(for: error, fallback: "Impossibile caricare le terapie.")
        }

        do {
            checkups = try await LocalAPIClient.shared.fetchCheckups(patientId: patientId, limit: 5)
            checkupsErrorMessage = nil
        } catch {
            checkups = []
            checkupsErrorMessage = message(for: error, fallback: "Impossibile caricare gli appuntamenti.")
        }

        updateAIPromptIfNeeded()
    }

    @MainActor
    private func runAI() async {
        if isAILoading { return }
        isAILoading = true
        aiErrorMessage = nil
        defer { isAILoading = false }

        do {
            let config = try await AISettingsResolver.resolveClinicalConfig()
            let raw = try await LocalAPIClient.shared.aiChat(prompt: aiPrompt, model: config.model, baseURL: config.baseURL)
            /* @Codex */
            let cleaned = cleanAIResponse(raw)
            aiResponse = "Modello: \(config.model)\n\n" + cleaned
        } catch {
            aiErrorMessage = "Errore AI: verifica Ollama/MLX"
        }
    }

    /* @Codex */
    private func cleanAIResponse(_ value: String) -> String {
        var output = value
        if let range = output.range(of: "<unused94>") {
            if let end = output.range(of: "<unused95>") {
                output.removeSubrange(range.lowerBound..<end.upperBound)
            } else {
                output.removeSubrange(range.lowerBound..<output.endIndex)
            }
        }
        output = output.replacingOccurrences(of: "<think>", with: "")
        output = output.replacingOccurrences(of: "</think>", with: "")
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func updateAIPromptIfNeeded() {
        guard aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard let detail else { return }

        var lines: [String] = []
        let age = ageText(from: detail.birthDate)
        lines.append("Paziente: \(detail.firstName) \(detail.lastName), \(age).")

        if let notes = security.decryptString(detail.notes), !notes.isEmpty {
            lines.append("Note: \(notes)")
        }

        if !entries.isEmpty {
            lines.append("Ultime voci cliniche:")
            for entry in entries.prefix(3) {
                let content = security.decryptString(entry.content) ?? "[cifrato]"
                lines.append("- \(formatted(date: entry.date)): \(content)")
            }
        }

        if !therapies.isEmpty {
            lines.append("Terapie:")
            for therapy in therapies.prefix(3) {
                lines.append("- \(therapy.drugName) (\(therapy.dosage)) [\(therapy.status)]")
            }
        }

        if !checkups.isEmpty {
            lines.append("Appuntamenti:")
            for checkup in checkups.prefix(3) {
                lines.append("- \(formatted(date: checkup.date)): \(checkup.title) [\(checkup.status)]")
            }
        }

        lines.append("Fornisci un riassunto clinico sintetico e punti di attenzione.")
        aiPrompt = lines.joined(separator: "\n")
    }

    private func formatted(date: Date?) -> String {
        guard let date else { return "n/d" }
        return Self.dateFormatter.string(from: date)
    }

    private func message(for error: Error, fallback: String) -> String {
        if let localError = error as? LocalAPIError {
            return localError.localizedDescription
        }
        return fallback
    }

    private func displayValue(_ encrypted: String?) -> String {
        if let decrypted = security.decryptString(encrypted) {
            return decrypted
        }
        return encrypted == nil || encrypted?.isEmpty == true ? "n/d" : "[Dati cifrati]"
    }

    private func displayNotes(_ encrypted: String?) -> String {
        let value = displayValue(encrypted)
        if value == "n/d" || value == "[Dati cifrati]" { return value }
        return value.isEmpty ? "Nessuna nota" : value
    }

    private func ageText(from date: Date?) -> String {
        guard let date else { return "n/d" }
        let years = Calendar.current.dateComponents([.year], from: date, to: Date()).year
        if let years, years >= 0 {
            return "\(years) anni"
        }
        return "n/d"
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
}

private struct PatientHeaderView: View {
    let detail: PatientDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(detail.lastName) \(detail.firstName)")
                .font(.largeTitle.weight(.semibold))

            HStack(spacing: 12) {
                Text("CF \(detail.taxCode)")
                if let birthDate = detail.birthDate {
                    Text("• \(formatted(date: birthDate))")
                }
            }
            .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                if detail.isAdi == true {
                    TagView(text: "ADI", tone: .accentColor)
                }
                if detail.isArchived == true {
                    TagView(text: "Archiviato", tone: .orange)
                }
            }
        }
    }

    private func formatted(date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

private struct InfoRow: Identifiable {
    let id = UUID()
    let label: String
    let value: String
}

private struct InfoGrid: View {
    let rows: [InfoRow]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
            ForEach(rows) { row in
                GridRow {
                    Text(row.label)
                        .foregroundStyle(.secondary)
                    Text(row.value)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct EntryRowView: View {
    let entry: EntrySummary
    let content: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName(for: entry.type))
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label(for: entry.type))
                        .font(.headline)
                    Spacer()
                    Text(dateFormatter.string(from: entry.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(content)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
    }

    private func label(for type: String) -> String {
        switch type {
        case "visit": return "Visita"
        case "phone": return "Telefonata"
        case "exam": return "Esame"
        case "hospitalization": return "Ricovero"
        case "access": return "Accesso"
        case "note": return "Nota"
        case "scale": return "Scala"
        case "remote": return "Telemedicina"
        default: return type.capitalized
        }
    }

    private func iconName(for type: String) -> String {
        switch type {
        case "visit": return "stethoscope"
        case "phone": return "phone"
        case "exam": return "testtube.2"
        case "hospitalization": return "cross.case"
        case "access": return "door.left.hand.open"
        case "note": return "note.text"
        case "scale": return "chart.bar"
        case "remote": return "video"
        default: return "doc.text"
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

private struct TherapyRowView: View {
    let therapy: TherapySummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "pills")
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(therapy.drugName)
                        .font(.headline)
                    Spacer()
                    TagView(text: therapy.status.capitalized, tone: tone(for: therapy.status))
                }
                Text(therapy.dosage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text(dateRange(for: therapy))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func dateRange(for therapy: TherapySummary) -> String {
        let start = dateFormatter.string(from: therapy.startDate)
        if let end = therapy.endDate {
            return "\(start) → \(dateFormatter.string(from: end))"
        }
        return "\(start) → in corso"
    }

    private func tone(for status: String) -> Color {
        switch status.lowercased() {
        case "active": return .green
        case "paused": return .orange
        case "stopped": return .red
        default: return .secondary
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

private struct CheckupRowView: View {
    let checkup: CheckupSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "calendar")
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(checkup.title)
                        .font(.headline)
                    Spacer()
                    TagView(text: checkup.status.capitalized, tone: tone(for: checkup.status))
                }
                Text(dateFormatter.string(from: checkup.date))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func tone(for status: String) -> Color {
        switch status.lowercased() {
        case "pending": return .orange
        case "done": return .green
        case "cancelled": return .red
        default: return .secondary
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}
