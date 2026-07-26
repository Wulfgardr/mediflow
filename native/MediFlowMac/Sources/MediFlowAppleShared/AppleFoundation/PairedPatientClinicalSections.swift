import SwiftUI
import Charts

/* @Codex */
struct PairedPatientClinicalSections: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var checkupStatusFilter: CheckupStatusFilter
    @Binding var confirmsDeletingCheckup: Bool
    @Binding var checkupDeletionCandidateId: String?
    @Binding var confirmsDeletingObservation: Bool
    @Binding var observationDeletionCandidateId: String?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            checkupsSection
            observationsSection
        }
    }

    private var checkupsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            PairedPatientSectionHeader(model: model,
                title: "Controlli",
                subtitle: "Ultimi 20 controlli",
                systemImage: "calendar.badge.clock",
                refreshIdentifier: "homebase-refresh-checkups-button",
                accent: .controlli
            ) {
                Task { await model.loadSelectedPatientCheckups() }
            }

            if model.checkups.isEmpty {
                Text("Nessun controllo caricato.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack {
                    Spacer(minLength: 8)
                    Menu {
                        Picker("Stato controlli", selection: $checkupStatusFilter) {
                            ForEach(CheckupStatusFilter.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                    } label: {
                        Label(checkupStatusFilter.title, systemImage: "line.3.horizontal.decrease.circle")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("checkup-status-filter")
                }
                let filteredCheckups = CheckupFiltering.apply(model.checkups, filter: checkupStatusFilter)
                if filteredCheckups.isEmpty {
                    Text("Nessun controllo per questo filtro.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredCheckups, id: \.id) { checkup in
                        checkupRow(checkup)
                            .accessibilityIdentifier("checkup-row-\(checkup.id)")
                    }
                }
            }

            if model.isEditingCheckup {
                Divider()
                checkupForm(
                    title: "Modifica controllo online",
                    checkupTitle: $model.editCheckupTitle,
                    notes: $model.editCheckupNotes,
                    status: $model.editCheckupStatus,
                    date: $model.editCheckupDate,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-checkup-button",
                    canSubmit: model.canUpdateEditingCheckup,
                    onCancel: { model.cancelEditingCheckup() },
                    onSubmit: { Task { await model.updateEditingCheckup() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica i controlli prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            checkupForm(
                title: "Nuovo controllo online",
                checkupTitle: $model.newCheckupTitle,
                notes: $model.newCheckupNotes,
                status: $model.newCheckupStatus,
                date: $model.newCheckupDate,
                primaryLabel: "Salva controllo",
                primaryIdentifier: "homebase-create-checkup-button",
                canSubmit: model.canCreateCheckup,
                onCancel: nil,
                onSubmit: { Task { await model.createCheckupForSelectedPatient() } }
            )
            Text("Solo campi manuali non-AI. Nessuna coda offline o import documentale.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var observationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            PairedPatientSectionHeader(model: model,
                title: "Osservazioni",
                subtitle: "Ultime \(PairedPatientsWorkspaceSupport.clinicalPreviewCap) osservazioni",
                systemImage: "waveform.path.ecg",
                refreshIdentifier: "homebase-refresh-observations-button",
                accent: .controlli
            ) {
                Task { await model.loadSelectedPatientObservations() }
            }

            if model.observations.isEmpty {
                Text("Nessuna osservazione caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                let trends = ObservationTrendComputer.compute(model.observations)
                ForEach(model.observations, id: \.id) { observation in
                    observationRow(observation, trend: trends[observation.id] ?? .none)
                }
            }

            if model.isEditingObservation {
                Divider()
                observationForm(
                    title: "Modifica osservazione online",
                    display: $model.editObservationDisplay,
                    code: $model.editObservationCode,
                    value: $model.editObservationValue,
                    unitCode: $model.editObservationUnitCode,
                    notes: $model.editObservationNotes,
                    observedAt: $model.editObservationObservedAt,
                    codeResults: model.editObservationCodeTerminologyResults,
                    unitResults: model.editObservationUnitTerminologyResults,
                    isSearchingCode: model.isSearchingEditObservationCodeTerminology,
                    isSearchingUnit: model.isSearchingEditObservationUnitTerminology,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-observation-button",
                    canSubmit: model.canUpdateEditingObservation,
                    onCodeQueryChanged: { model.scheduleEditObservationCodeTerminologySearch() },
                    onUnitQueryChanged: { model.scheduleEditObservationUnitTerminologySearch() },
                    onSelectCode: { model.selectEditObservationCodeTerminology($0) },
                    onSelectUnit: { model.selectEditObservationUnitTerminology($0) },
                    onCancel: { model.cancelEditingObservation() },
                    onSubmit: { Task { await model.updateEditingObservation() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le osservazioni prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            observationForm(
                title: "Nuova osservazione online",
                display: $model.newObservationDisplay,
                code: $model.newObservationCode,
                value: $model.newObservationValue,
                unitCode: $model.newObservationUnitCode,
                notes: $model.newObservationNotes,
                observedAt: $model.newObservationObservedAt,
                codeResults: model.newObservationCodeTerminologyResults,
                unitResults: model.newObservationUnitTerminologyResults,
                isSearchingCode: model.isSearchingNewObservationCodeTerminology,
                isSearchingUnit: model.isSearchingNewObservationUnitTerminology,
                primaryLabel: "Salva osservazione",
                primaryIdentifier: "homebase-create-observation-button",
                canSubmit: model.canCreateObservation,
                onCodeQueryChanged: { model.scheduleNewObservationCodeTerminologySearch() },
                onUnitQueryChanged: { model.scheduleNewObservationUnitTerminologySearch() },
                onSelectCode: { model.selectNewObservationCodeTerminology($0) },
                onSelectUnit: { model.selectNewObservationUnitTerminology($0) },
                onCancel: nil,
                onSubmit: { Task { await model.createObservationForSelectedPatient() } }
            )
            Text("LOINC + UCUM manuali. Nessun AI plane remoto, OCR o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */

    private func checkupStatusColor(_ checkup: HomeBaseCheckupSummary) -> Color {
        if checkup.deletedAt != nil { return toneColor(.attention) }
        return toneColor(PairedCheckupStatus(rawValue: checkup.status)?.tone ?? .neutral)
    }

    /* @Codex */
    private func toneColor(_ tone: LumeTone) -> Color {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        return LumePalette.tint(for: tone, using: palette)
    }

    private func checkupRow(_ checkup: HomeBaseCheckupSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(checkup.title)
                    .chartRowTitle()
                Spacer(minLength: 8)
                Text(PairedCheckupStatus(rawValue: checkup.status)?.title ?? checkup.status)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(checkupStatusColor(checkup))
            }
            Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: checkup.date))
                .font(.caption2)
                .registro()
                .foregroundStyle(.secondary)
            if let notes = checkup.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(checkup.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if checkup.deletedAt != nil {
                Text("Controllo annullato")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(toneColor(.attention))
            } else if model.canMutateCheckup(checkup) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingCheckup(checkup)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-checkup-button-\(checkup.id)")

                    Button(role: .destructive) {
                        checkupDeletionCandidateId = checkup.id
                        confirmsDeletingCheckup = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-checkup-button-\(checkup.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(LumeRigaListaModifier(isSelected: false))
    }

    /* @Codex */
    /// "LOINC 29463-7 · 15/06/2025" instead of "http://loinc.org 29463-7 - ...".
    ///
    /// `codeSystem` carries the FHIR system URI, which identifies the coding
    /// system to a machine and says nothing to a clinician. Printed verbatim it
    /// spent the most readable line of the row on a namespace. Unknown systems
    /// still show their raw URI: inventing a friendly name for a system we do not
    /// recognise would be worse than showing what is actually recorded.
    private func observationProvenance(_ observation: HomeBaseObservationSummary) -> String {
        let date = PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: observation.observedAt)
        let system = Self.codingSystemLabel(observation.codeSystem)
        let code = observation.code.trimmingCharacters(in: .whitespacesAndNewlines)
        let coding = [system, code].filter { !$0.isEmpty }.joined(separator: " ")
        return coding.isEmpty ? date : "\(coding) · \(date)"
    }

    static func codingSystemLabel(_ system: String) -> String {
        switch system.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "http://loinc.org", "https://loinc.org", "loinc": return "LOINC"
        case "http://snomed.info/sct", "snomed": return "SNOMED CT"
        case "http://unitsofmeasure.org", "ucum": return "UCUM"
        case "http://hl7.org/fhir/sid/icd-10", "icd-10", "icd10": return "ICD-10"
        case "http://hl7.org/fhir/sid/icd-9-cm", "icd-9-cm", "icd9": return "ICD-9-CM"
        case "": return ""
        default: return system
        }
    }

    private func observationRow(_ observation: HomeBaseObservationSummary, trend: ObservationTrend) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            // Centred, not baseline-aligned: the sparkline has no text baseline,
            // so a baseline row shoved it to the top and it floated above the
            // value it belongs to.
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(observation.display)
                        // The name of the measure and its number are what this row
                        // is for. Both sat at caption size, smaller than the note
                        // beneath them.
                        .chartRowTitle()
                    Text(observationProvenance(observation))
                        .font(.caption2)
                        .registro()
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                // The sparkline belongs beside the number it summarises. Full
                // width under the row it read as a stray blue rule, and the empty
                // band it left made every observation twice as tall as its content.
                let series = numericObservationSeries(forCode: observation.code)
                if observation.deletedAt == nil, series.count >= 2 {
                    Chart(series) { point in
                        LineMark(x: .value("Data", point.date), y: .value("Valore", point.value))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(.secondary)
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .frame(width: 96, height: 22)
                    .accessibilityIdentifier("observation-sparkline-\(observation.code)")
                    .accessibilityLabel("Andamento \(observation.display): \(series.count) rilevazioni")
                }

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if observation.deletedAt == nil, let glyph = Self.trendGlyph(trend) {
                        Image(systemName: glyph.symbol)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("observation-trend-\(observation.id)")
                            .accessibilityLabel(glyph.label)
                    }
                    Text(observation.value)
                        #if os(macOS)
                        .font(.title3.weight(.semibold))
                        #else
                        .font(.caption2.weight(.semibold))
                        #endif
                        .registro()
                        .foregroundStyle(observation.deletedAt == nil ? Color.primary : Color.secondary)
                    Text(observation.unitCode)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            if let notes = observation.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(observation.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if observation.deletedAt != nil {
                Text("Osservazione annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(toneColor(.attention))
            } else if model.canMutateObservation(observation) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingObservation(observation)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-observation-button-\(observation.id)")

                    Button(role: .destructive) {
                        observationDeletionCandidateId = observation.id
                        confirmsDeletingObservation = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-observation-button-\(observation.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(LumeRigaListaModifier(isSelected: false))
    }

    private struct ObservationPoint: Identifiable {
        let id: Int
        let date: Date
        let value: Double
    }

    // The numeric time-series for a LOINC code across the loaded (non-deleted)
    // observations, oldest-first, for the inline sparkline. Non-numeric values
    // (e.g. "120/80", "positivo") are skipped, so a series appears only for scalar
    // parameters with >= 2 readings.
    private func numericObservationSeries(forCode code: String) -> [ObservationPoint] {
        model.observations
            .filter { $0.code == code && $0.deletedAt == nil }
            .compactMap { obs -> (Date, Double)? in
                guard let value = Self.parseObservationValue(obs.value) else { return nil }
                return (obs.observedAt, value)
            }
            .sorted { $0.0 < $1.0 }
            .enumerated()
            .map { ObservationPoint(id: $0.offset, date: $0.element.0, value: $0.element.1) }
    }

    static func parseObservationValue(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if let direct = Double(trimmed) { return direct }
        return Double(trimmed.replacingOccurrences(of: ",", with: "."))
    }

    /// SF Symbol + accessibility label for an observation trend. Clinically neutral:
    /// a direction only, never a good/bad color. Returns nil for `.none` (no arrow).
    private static func trendGlyph(_ trend: ObservationTrend) -> (symbol: String, label: String)? {
        switch trend {
        case .rising:
            return ("arrow.up.right", "Valore in aumento rispetto alla rilevazione precedente")
        case .falling:
            return ("arrow.down.right", "Valore in diminuzione rispetto alla rilevazione precedente")
        case .steady:
            return ("arrow.right", "Valore stabile rispetto alla rilevazione precedente")
        case .none:
            return nil
        }
    }

    /* @Codex */
    private func checkupForm(
        title: String,
        checkupTitle: Binding<String>,
        notes: Binding<String>,
        status: Binding<PairedCheckupStatus>,
        date: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "calendar.badge.clock")
                // A form opens a group inside a card, so it takes the group
                // heading register — the same one "DIAGNOSI" and "NOTE" use.
                // Left at caption it was indistinguishable from the placeholder
                // text of the fields it introduces.
                .chartGroupHeading()
            TextField("Titolo", text: checkupTitle)
                .accessibilityIdentifier("\(primaryIdentifier)-title")
            Picker("Stato", selection: status) {
                ForEach(PairedCheckupStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Data", selection: date, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-date")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            PairedPatientFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    private func observationForm(
        title: String,
        display: Binding<String>,
        code: Binding<String>,
        value: Binding<String>,
        unitCode: Binding<String>,
        notes: Binding<String>,
        observedAt: Binding<Date>,
        codeResults: [HomeBaseTerminologyItem],
        unitResults: [HomeBaseTerminologyItem],
        isSearchingCode: Bool,
        isSearchingUnit: Bool,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCodeQueryChanged: @escaping () -> Void,
        onUnitQueryChanged: @escaping () -> Void,
        onSelectCode: @escaping (HomeBaseTerminologyItem) -> Void,
        onSelectUnit: @escaping (HomeBaseTerminologyItem) -> Void,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "waveform.path.ecg")
                // A form opens a group inside a card, so it takes the group
                // heading register — the same one "DIAGNOSI" and "NOTE" use.
                // Left at caption it was indistinguishable from the placeholder
                // text of the fields it introduces.
                .chartGroupHeading()
            TextField("Parametro LOINC", text: display)
                .accessibilityIdentifier("\(primaryIdentifier)-display")
            TextField("Codice LOINC", text: code)
                .accessibilityIdentifier("\(primaryIdentifier)-code")
                .onChange(of: code.wrappedValue) { _ in
                    onCodeQueryChanged()
                }
            terminologyResultsList(
                title: "LOINC",
                results: codeResults,
                isLoading: isSearchingCode,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectCode
            )
            HStack(spacing: 8) {
                TextField("Valore", text: value)
                    .accessibilityIdentifier("\(primaryIdentifier)-value")
                TextField("Unità UCUM", text: unitCode)
                    .accessibilityIdentifier("\(primaryIdentifier)-unit-code")
                    .onChange(of: unitCode.wrappedValue) { _ in
                        onUnitQueryChanged()
                    }
            }
            terminologyResultsList(
                title: "UCUM",
                results: unitResults,
                isLoading: isSearchingUnit,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectUnit
            )
            DatePicker("Rilevata", selection: observedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-observed-at")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            PairedPatientFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    @ViewBuilder
    private func terminologyResultsList(
        title: String,
        results: [HomeBaseTerminologyItem],
        isLoading: Bool,
        primaryIdentifier: String,
        onSelect: @escaping (HomeBaseTerminologyItem) -> Void
    ) -> some View {
        if isLoading || !results.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if isLoading {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca \(title)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(results) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.code)
                                .font(.caption.monospaced().weight(.semibold))
                                .registro()
                            Text(item.display)
                                .font(.caption)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            Image(systemName: "checkmark.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(primaryIdentifier)-terminology-\(title)-\(item.code)")
                }
            }
        }
    }

    /* @Codex */
}
