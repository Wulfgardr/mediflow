import SwiftUI

/* @Codex */
struct PairedPatientDetailSection: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let detail: HomeBasePatientDetail
    @Binding var patientLifecycleSheet: PatientLifecycleSheet?
    @Binding var icdQuery: String
    @Binding var confirmsFHIRExport: Bool

    /// Groups now carry their own internal rhythm through `ChartGroup`, so the
    /// per-platform spacing constants this view used to keep are gone: 4 points
    /// on iOS against 8 on macOS was itself part of why the phone read as
    /// cramped.

    var body: some View {
        let exemptions = ExemptionCodesCodec.decode(detail.exemptions)
        let groupSpacing = ClinicalChartMetrics.groupSpacing
        return VStack(alignment: .leading, spacing: groupSpacing) {
            #if os(macOS)
            // macOS states the patient in the window title bar and keeps the
            // chart actions in the toolbar, so this card only needs its name.
            patientHeaderTitle
            #else
            // On iOS the card is titled by the patient, and the actions sit on
            // that line rather than above it.
            //
            // They used to be a five-cell grid stacked at the very top of the
            // chart: roughly 330 points of secondary controls before the reader
            // reached a single clinical fact. Editing is the one action taken
            // often enough to stay in view; archive, delete, FHIR export and the
            // regional handoff are occasional, and an occasional action belongs
            // behind an overflow rather than in front of the record.
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(detail.lastName) \(detail.firstName)")
                    .chartCardTitle()
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(detail.lastName) \(detail.firstName)")
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("patient-detail-name")
                Spacer(minLength: 8)
                primaryEditAction
                patientActionsOverflowMenu
            }
            #endif
            if detail.isAdi == true || detail.isArchived == true {
                HStack(spacing: 6) {
                    if detail.isAdi == true { PairedPatientFlagChip("ADI", tone: .info) }
                    if detail.isArchived == true { PairedPatientFlagChip("Archiviato", tone: .neutral) }
                }
            }
            patientSignals(detail, exemptionsCount: exemptions.count)

            // Four groups, not one list of nine rows.
            //
            // Every identity field sat in a single stack four points apart, so
            // "Codice fiscale" was as close to "Data di nascita" as "Indirizzo"
            // was to "Ambulatorio" — and proximity therefore said nothing. These
            // fields are not one thing: who the patient is, how to reach them,
            // who is looking after them and what they are exempt from are four
            // separate questions a clinician asks at four different moments.
            // Grouping them is what lets the eye jump to the right one instead
            // of reading the column.
            ChartGroup("Identità") {
                InfoRow("Codice fiscale", detail.taxCode)
                if let birth = detail.birthDate {
                    InfoRow("Data di nascita", PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: birth))
                }
            }

            let contacts: [(String, String)] = [
                ("Indirizzo", cleanedPatientWorkspaceValue(detail.address)),
                ("Telefono", cleanedPatientWorkspaceValue(detail.phone)),
            ].compactMap { label, value in value.map { (label, $0) } }
            if !contacts.isEmpty {
                ChartGroup("Contatti") {
                    ForEach(contacts, id: \.0) { InfoRow($0.0, $0.1) }
                }
            }

            let care: [(String, String)] = [
                ("Caregiver", cleanedPatientWorkspaceValue(detail.caregiver)),
                ("Ambulatorio", cleanedPatientWorkspaceValue(detail.ambulatoryId)),
                ("Monitoraggio", cleanedPatientWorkspaceValue(detail.monitoringProfile)),
            ].compactMap { label, value in value.map { (label, $0) } }
            if !care.isEmpty {
                ChartGroup("Presa in carico") {
                    ForEach(care, id: \.0) { InfoRow($0.0, $0.1) }
                }
            }

            if !exemptions.isEmpty {
                ChartGroup("Esenzioni") {
                    HStack(spacing: 6) {
                        ForEach(exemptions, id: \.self) { ClinicalCodePill($0) }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Esenzioni: \(exemptions.joined(separator: ", "))")
                }
                .accessibilityIdentifier("patient-detail-exemptions")
            }
            // From here down the two platforms share one treatment. They used to
            // fork on every block — group heading and prose registers on macOS,
            // `.caption`/`.callout` inline on iOS — which is how iOS ended up
            // with headings that looked like field labels and prose that looked
            // like everything else. The registers are cross-platform now, so the
            // fork has nothing left to say.
            let diagnoses = DiagnosesCodec.decode(detail.diagnoses)
            if !diagnoses.isEmpty {
                // The diagnoses are the clinical statement of who this patient
                // is. Set at callout, in the same face and size as an address,
                // they were the least prominent thing on a card that exists to
                // carry them. Code and description are separated because they
                // are read differently: the code is matched, the description read.
                ChartGroup("Diagnosi") {
                    ForEach(Array(diagnoses.enumerated()), id: \.offset) { _, diagnosis in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if !diagnosis.code.isEmpty {
                                ClinicalCodePill(diagnosis.code)
                            }
                            Text(diagnosis.description)
                                .font(.body)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(diagnosis.displayText)
                    }
                }
                .accessibilityIdentifier("patient-detail-diagnoses")
            }
            if let aiSummary = cleanedPatientWorkspaceValue(detail.aiSummary) {
                ChartGroup("Sintesi AI", systemImage: "sparkles") {
                    Text(aiSummary).chartProse()
                }
                .accessibilityIdentifier("patient-detail-ai-summary")
            }
            if let documentInsights = cleanedPatientWorkspaceValue(detail.documentInsights) {
                ChartGroup("Analisi documenti", systemImage: "doc.text.magnifyingglass") {
                    Text(documentInsights).chartProse()
                }
                .accessibilityIdentifier("patient-detail-document-insights")
            }
            if let statusReason = cleanedPatientWorkspaceValue(detail.statusReason) {
                Text(statusReason)
                    .chartMetadata()
            }
            if let notes = cleanedPatientWorkspaceValue(detail.notes) {
                ChartGroup("Note") {
                    Text(notes).chartProse()
                }
            }
            if model.isEditingPatient {
                Divider()
                patientEditForm
            }
        }
    }

    private var patientHeaderTitle: some View {
        // Names the card. It used to share the row with the chart actions, which
        // now live in the window toolbar, so it reads as the card's title and
        // takes the heading register — leaving the field block below it
        // unlabelled, because that block *is* the anagrafica this card is named
        // for and a second "Dati anagrafici" only said it twice.
        // Same treatment as "Diario clinico", "Controlli", "Terapie": these are
        // peers, each the title of a card, so each carries the card-title
        // register and its own section glyph. The platform fork that used to
        // live here is gone: `ClinicalSectionTitle` resolves the register for
        // both, which is the point of having named registers at all.
        ClinicalSectionTitle("Anagrafica", systemImage: "person.text.rectangle", accent: .anagrafica)
    }

    @ViewBuilder
    private var patientHeaderActions: some View {
        #if os(macOS)
        // Nothing: on macOS these actions are window toolbar items. Duplicated
        // inside the chart they formed a button grid that outweighed the
        // clinical content it sat above.
        EmptyView()
        #else
        patientHeaderActionsGrid
        #endif
    }

    /// Editing stays in view. It is the action a clinician reaches for while
    /// reading the card, and burying it would cost a tap on every correction.
    private var primaryEditAction: some View {
        Button {
            model.startEditingPatient()
        } label: {
            Label("Modifica", systemImage: "pencil")
        }
        .font(.caption)
        .labelStyle(.titleAndIcon)
        .disabled(model.isEditingPatient)
        .accessibilityIdentifier("edit-patient-button")
    }

    /// Everything a clinician does rarely: archive, delete, export, hand off.
    /// Full-length labels inside the menu, where there is room for them.
    private var patientActionsOverflowMenu: some View {
        Menu {
            if detail.isArchived == true {
                Button {
                    patientLifecycleSheet = .unarchive
                } label: {
                    Label("Riattiva", systemImage: "archivebox")
                }
                .disabled(!model.canUnarchivePatient)
                .accessibilityIdentifier("unarchive-patient-button")
            } else {
                Button {
                    patientLifecycleSheet = .archive
                } label: {
                    Label("Archivia", systemImage: "archivebox")
                }
                .disabled(!model.canArchivePatient)
                .accessibilityIdentifier("archive-patient-button")
            }
            Button {
                confirmsFHIRExport = true
            } label: {
                Label("Esporta FHIR", systemImage: "doc.badge.arrow.up")
            }
            .disabled(!model.canPrepareFHIRExport)
            .accessibilityIdentifier("patient-export-fhir-button")
            if let fhirURL = model.patientFHIRExportURL {
                ShareLink(item: fhirURL) {
                    Label("Condividi FHIR", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("patient-share-fhir-button")
            }
            Button {
                Task { await model.openPrregHandoff() }
            } label: {
                Label("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
            }
            .accessibilityIdentifier("patient-prreg-handoff-button")
            Divider()
            Button(role: .destructive) {
                patientLifecycleSheet = .delete
            } label: {
                Label("Elimina", systemImage: "trash")
            }
            .disabled(!model.canSoftDeletePatient)
            .accessibilityIdentifier("soft-delete-patient-button")
        } label: {
            Label("Altre azioni", systemImage: "ellipsis.circle")
                .font(.caption)
        }
        .labelStyle(.iconOnly)
        .accessibilityLabel("Altre azioni sul paziente")
        .accessibilityIdentifier("patient-actions-overflow")
    }

    private var patientHeaderActionsGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 132), spacing: 8, alignment: .leading)],
            alignment: .leading,
            spacing: 6
        ) {
            patientHeaderActionButtons
        }
    }

    @ViewBuilder
    private var patientHeaderActionButtons: some View {
        Button {
            model.startEditingPatient()
        } label: {
            patientHeaderActionLabel("Modifica", systemImage: "pencil")
        }
        .font(.caption)
        .disabled(model.isEditingPatient)
        .accessibilityIdentifier("edit-patient-button")
        if detail.isArchived == true {
            Button {
                patientLifecycleSheet = .unarchive
            } label: {
                patientHeaderActionLabel("Riattiva", systemImage: "archivebox")
            }
            .font(.caption)
            .disabled(!model.canUnarchivePatient)
            .accessibilityIdentifier("unarchive-patient-button")
        } else {
            Button {
                patientLifecycleSheet = .archive
            } label: {
                patientHeaderActionLabel("Archivia", systemImage: "archivebox")
            }
            .font(.caption)
            .disabled(!model.canArchivePatient)
            .accessibilityIdentifier("archive-patient-button")
        }
        Button(role: .destructive) {
            patientLifecycleSheet = .delete
        } label: {
            patientHeaderActionLabel("Elimina", systemImage: "trash")
        }
        .font(.caption)
        .disabled(!model.canSoftDeletePatient)
        .accessibilityIdentifier("soft-delete-patient-button")
        Button {
            confirmsFHIRExport = true
        } label: {
            patientHeaderActionLabel("Esporta FHIR", systemImage: "doc.badge.arrow.up")
        }
        .font(.caption)
        .disabled(!model.canPrepareFHIRExport)
        .accessibilityIdentifier("patient-export-fhir-button")
        if let fhirURL = model.patientFHIRExportURL {
            ShareLink(item: fhirURL) {
                patientHeaderActionLabel("Condividi FHIR", systemImage: "square.and.arrow.up")
                    .font(.caption)
            }
            .accessibilityIdentifier("patient-share-fhir-button")
        }
        Button {
            Task { await model.openPrregHandoff() }
        } label: {
            patientHeaderActionLabel("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
        }
        .font(.caption)
        .accessibilityIdentifier("patient-prreg-handoff-button")
    }

    private func patientHeaderActionLabel(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }

    private var patientEditForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modifica anagrafica")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Nome", text: $model.editPatientFirstName)
                .accessibilityIdentifier("edit-patient-firstName")
            TextField("Cognome", text: $model.editPatientLastName)
                .accessibilityIdentifier("edit-patient-lastName")
            TextField("Codice fiscale", text: $model.editPatientTaxCode)
                .accessibilityIdentifier("edit-patient-taxCode")
            /* @Codex */
            TextField("Indirizzo", text: $model.editPatientAddress)
                .accessibilityIdentifier("edit-patient-address")
                .disabled(model.isPatientFieldLocked(.address))
            TextField("Telefono", text: $model.editPatientPhone)
                .accessibilityIdentifier("edit-patient-phone")
                .disabled(model.isPatientFieldLocked(.phone))
            TextField("Caregiver", text: $model.editPatientCaregiver)
                .accessibilityIdentifier("edit-patient-caregiver")
                .disabled(model.isPatientFieldLocked(.caregiver))
            TextField("Note", text: $model.editPatientNotes, axis: .vertical)
                .accessibilityIdentifier("edit-patient-notes")
                .disabled(model.isPatientFieldLocked(.notes))
            if !model.lockedPatientFields.isEmpty {
                Label("Alcuni dati cifrati non sono disponibili e non verranno modificati.", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("edit-patient-locked-fields-message")
            }
            Toggle("Archiviato", isOn: $model.editPatientIsArchived)
                .accessibilityIdentifier("edit-patient-archived")
            Toggle("ADI (assistenza domiciliare)", isOn: $model.editPatientIsAdi)
                .accessibilityIdentifier("edit-patient-adi")

            VStack(alignment: .leading, spacing: 4) {
                Text("Diagnosi")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(Array(model.editPatientDiagnoses.enumerated()), id: \.offset) { index, diagnosis in
                    HStack {
                        Text(diagnosis.displayText)
                            .font(.callout)
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeDiagnosis(at: IndexSet(integer: index))
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-diagnosis-\(index)")
                    }
                }
                // A14: in-app ICD search (ADR 0070), no external proxy. Tapping a
                // result adds the coded diagnosis with its system.
                TextField("Cerca ICD (in-app)", text: $icdQuery)
                    .accessibilityIdentifier("icd-search-field")
                if !icdQuery.isEmpty {
                    ForEach(ICDCatalog.search(icdQuery, limit: 6)) { icd in
                        Button {
                            model.addDiagnosis(code: icd.code, description: icd.description, system: icd.system)
                            icdQuery = ""
                        } label: {
                            // Set exactly like the diagnoses above: the same
                            // pill, the same description register. A suggestion
                            // should look like the thing it is about to become,
                            // so you can see what you are adding before you add
                            // it. As one monospaced string the code and the
                            // description shared a face, and the description —
                            // which is prose — was typeset as though it were a
                            // code.
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                ClinicalCodePill(icd.code)
                                Text(icd.description)
                                    .font(.subheadline)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 4)
                                Image(systemName: "plus.circle")
                                    .foregroundStyle(.tint)
                            }
                            .padding(.vertical, 4)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Aggiungi \(icd.code), \(icd.description)")
                        .accessibilityIdentifier("icd-result-\(icd.code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice", text: $model.newDiagnosisCode)
                        .accessibilityIdentifier("new-diagnosis-code")
                        .frame(maxWidth: 120)
                    TextField("Descrizione", text: $model.newDiagnosisDescription)
                        .accessibilityIdentifier("new-diagnosis-description")
                    Button {
                        model.addDiagnosis()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-diagnosis-button")
                }
            }
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.diagnoses))

            VStack(alignment: .leading, spacing: 4) {
                Text("Esenzioni")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if model.editPatientExemptions.isEmpty {
                    Text("Nessuna esenzione")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                ForEach(model.editPatientExemptions, id: \.self) { code in
                    HStack {
                        Text(code)
                            .font(.callout)
                            .registro()
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeExemption(code)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-exemption-\(code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice esenzione", text: $model.newExemptionCode)
                        .accessibilityIdentifier("new-exemption-code")
                        .frame(maxWidth: 160)
                        .onChange(of: model.newExemptionCode) { _ in
                            model.scheduleExemptionCatalogSearch()
                        }
                    Button {
                        model.addExemption()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-exemption-button")
                }
                exemptionCatalogResultsList
            }
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.exemptions))

            HStack(spacing: 10) {
                Button("Salva") {
                    Task { await model.savePatient() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)
                .accessibilityIdentifier("save-patient-button")
                Button("Annulla") {
                    model.cancelEditingPatient()
                }
                .accessibilityIdentifier("cancel-patient-button")
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    /* @Codex */
    @ViewBuilder
    private var exemptionCatalogResultsList: some View {
        if model.isSearchingExemptionCatalog
            || model.exemptionCatalogStatusMessage != nil
            || !model.exemptionCatalogResults.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if model.isSearchingExemptionCatalog {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca catalogo esenzioni")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let status = model.exemptionCatalogStatusMessage {
                    Text(status)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(model.exemptionCatalogResults) { exemption in
                    Button {
                        model.selectExemptionCatalogResult(exemption)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(exemption.code)
                                .font(.caption.monospaced().weight(.semibold))
                                .registro()
                            Text(exemption.description)
                                .font(.caption)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            Image(systemName: "plus.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("exemption-catalog-result-\(exemption.code)")
                }
            }
        }
    }


    private func signalTile(_ icon: String, _ signal: ClinicalSignalCount, _ label: String) -> some View {
        let layout = dynamicTypeSize >= .accessibility1
            ? AnyLayout(HStackLayout(spacing: 6))
            : AnyLayout(VStackLayout(spacing: 2))
        return layout {
            Group {
                Image(systemName: icon)
                    #if os(macOS)
                    // The icon names the measure; the number is the thing being
                    // read. Same weight for both made the tile a uniform grey
                    // block where nothing led.
                    .font(.caption)
                    .foregroundStyle(.tint)
                    #else
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    #endif
                Text(signal.displayText)
                    #if os(macOS)
                    .font(.title3.weight(.semibold))
                    #else
                    .font(.callout.weight(.semibold))
                    #endif
                    .registro()
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if dynamicTypeSize >= .accessibility1 {
                Spacer(minLength: 4)
            }
        }
        .frame(maxWidth: .infinity)
        #if os(macOS)
        .padding(.vertical, 10)
        // Concentric with the card that contains it: the card rounds at
        // ClinicalChartMetrics.cardRadius and insets its content by
        // cardPadding, so a tile flush with that inset rounds at the difference.
        // Given the same radius as its parent, a nested box reads as pasted on
        // rather than sitting inside.
        .background(
            Color.secondary.opacity(0.07),
            in: RoundedRectangle(cornerRadius: ClinicalChartMetrics.innerRadius, style: .continuous)
        )
        #else
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        #endif
    }

    // Quadro clinical-signals strip (parity with the web "segnali clinici"): counts
    // derived from the already-loaded collections + the next upcoming follow-up.
    /// Six tiles, so three columns divide evenly into two full rows at any chart
    /// width. The adaptive grid fitted five across and left "Esenzioni" alone on
    /// a second row, which reads as a mistake rather than as a group.
    private var signalTileColumns: [GridItem] {
        if dynamicTypeSize >= .accessibility1 { return [GridItem(.flexible())] }
        #if os(macOS)
        return Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
        #else
        return [GridItem(.adaptive(minimum: 84), spacing: 8)]
        #endif
    }

    @ViewBuilder
    private func patientSignals(_ detail: HomeBasePatientDetail, exemptionsCount: Int) -> some View {
        let cap = PairedPatientsWorkspaceSupport.clinicalPreviewCap
        let problemi = DiagnosesCodec.decode(detail.diagnoses).count
        let terapie = model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }.count
        let parametri = model.observations.filter { $0.deletedAt == nil }.count
        let diario = model.entries.filter { $0.deletedAt == nil }.count
        let scale = model.entries.filter { $0.deletedAt == nil && $0.type == "scale" }.count
        let nextCheckup = model.checkups
            .filter { $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() }
            .min(by: { $0.date < $1.date })
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(
                columns: signalTileColumns,
                spacing: 8
            ) {
                signalTile("cross.case", .exact(problemi), "Problemi")
                signalTile(
                    "pills",
                    .fromLoadedList(count: terapie, loadedCount: model.therapies.count, limit: cap),
                    "Terapie"
                )
                signalTile(
                    "waveform.path.ecg",
                    .fromLoadedList(count: parametri, loadedCount: model.observations.count, limit: cap),
                    "Parametri"
                )
                signalTile(
                    "list.bullet.clipboard",
                    .fromLoadedList(count: diario, loadedCount: model.entries.count, limit: cap),
                    "Diario"
                )
                signalTile(
                    "checklist",
                    .fromLoadedList(count: scale, loadedCount: model.entries.count, limit: cap),
                    "Scale"
                )
                signalTile("seal", .exact(exemptionsCount), "Esenzioni")
            }
            .accessibilityIdentifier("patient-clinical-signals")
            if let next = nextCheckup {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        nextFollowUpText(next)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        nextFollowUpText(next)
                    }
                }
                .accessibilityIdentifier("patient-next-followup")
            }
        }
    }

    private func nextFollowUpText(_ next: HomeBaseCheckupSummary) -> some View {
        Text("Prossimo follow-up: \(PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: next.date)) · \(next.title)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

}
