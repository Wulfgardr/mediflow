import SwiftUI

/* @Codex */
struct PairedHomeBaseCredentialsView: View {
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var confirmsClearingPairing: Bool

    private var actionColumns: [GridItem] {
        // @Codex #143: keep setup actions as readable rows at accessibility sizes.
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible())]
            : [GridItem(.adaptive(minimum: 150), spacing: 8)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Collegamento MediFlow")
                .font(.headline)
            Text("Configura il collegamento al computer MediFlow e accedi con il PIN operatore.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Label(model.connectionState.title, systemImage: model.connectionState.symbolName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(model.connectionState.tintColor)
                .accessibilityIdentifier("homebase-connection-state")
            Text(model.reconciliationLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("homebase-reconciliation-state")
            TextField("Server HTTPS", text: $model.serverURL)
                .accessibilityIdentifier("homebase-server-url-field")
            TextField("Fingerprint SHA256 (opzionale)", text: $model.tlsPin)
                .accessibilityIdentifier("homebase-tls-pin-field")
            Button("Scopri in LAN") {
                Task { await model.discoverHomeBase() }
            }
            .accessibilityIdentifier("homebase-discover-button")
            .disabled(model.isWorking)
            .frame(maxWidth: .infinity, alignment: .leading)
            TextField("Paired client ID", text: $model.pairedClientId)
                .accessibilityIdentifier("homebase-paired-client-id-field")
            SecureField("Paired client token", text: $model.pairedClientToken)
                .accessibilityIdentifier("homebase-paired-client-token-field")
            TextField("Username (opzionale se utente unico)", text: $model.username)
                .accessibilityIdentifier("homebase-username-field")
            SecureField("PIN operatore", text: $model.password)
                .accessibilityIdentifier("homebase-password-field")
            TextField("Ambulatorio attivo (opzionale)", text: $model.ambulatoryId)
                .accessibilityIdentifier("homebase-ambulatory-field")
            // The ambulatory scope picker used to live here, in the pairing form.
            // It has moved to the patients workspace toolbar: the active
            // ambulatory is the scope a clinician works in and changes during a
            // shift, not a setting they configured once when pairing the device.
            // Buried in "Collegamento MediFlow" it was unreachable without
            // opening a configuration sheet — and on iOS that sheet is not even
            // on the same screen as the list it scopes.
            LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                Button("Accedi operatore") {
                    Task { await model.login() }
                }
                .accessibilityIdentifier("homebase-login-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Carica pazienti") {
                    Task { await model.loadPatients() }
                }
                .accessibilityIdentifier("homebase-load-patients-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Salva dispositivo") {
                    Task { await model.savePairing() }
                }
                .accessibilityIdentifier("homebase-save-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Dissocia") {
                    confirmsClearingPairing = true
                }
                .tint(.red)
                .accessibilityIdentifier("homebase-clear-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("PIN operatore e sessione restano locali e vengono richiesti a ogni riapertura.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let message = model.discoveryMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-discovery-message")
            }
            if let message = model.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-status-message")
            }
            if let error = model.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("homebase-error-message")
            }
        }
        .padding(16)
        .lumeSurface(zone: .field)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("homebase-configuration-form")
        .confirmationDialog(
            "Dissociare questo dispositivo?",
            isPresented: $confirmsClearingPairing,
            titleVisibility: .visible
        ) {
            Button("Dissocia dispositivo", role: .destructive) {
                Task { await model.clearPairing() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Rimuove credenziali paired e snapshot locale da questo dispositivo.")
        }
    }

}

/* @Codex */
struct PairedHomeBaseCredentialsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var confirmsClearingPairing: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                PairedHomeBaseCredentialsView(
                    model: model,
                    confirmsClearingPairing: $confirmsClearingPairing
                )
                .padding(20)
            }
            .navigationTitle("Collegamento MediFlow")
            #if os(iOS)
            // @Codex #143: keep the setup title readable on compact screens.
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Chiudi") {
                        dismiss()
                    }
                    .accessibilityLabel("Chiudi configurazione collegamento")
                    .accessibilityIdentifier("homebase-configuration-close-button")
                }
            }
            .accessibilityIdentifier("homebase-configuration-sheet")
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 600)
        #endif
    }
}

/// Worklist actions are real controls, not caption-sized text. 44pt is the HIG
/// touch-target minimum, not a device metric, and the label still grows past it
/// with Dynamic Type. macOS keeps its existing compact presentation.
private struct WorklistPrimaryActionStyle: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.font(.caption)
        #else
        content
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        #endif
    }
}

/* @Codex */
struct PairedPatientsWorklistView: View {
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var patientQuery: String
    @Binding var patientViewMode: PatientListViewMode
    @Binding var patientSortMode: PatientListSortMode
    // @Codex: Compact navigation belongs to the workspace, not to a row.
    var onOpenPatient: ((HomeBasePatientSummary) -> Void)? = nil

    @ViewBuilder
    var body: some View {
        #if os(macOS)
        // @Codex: Keep the heading and filters fixed above the native list.
        // Creation belongs to the workspace toolbar, which owns its capability gate.
        VStack(alignment: .leading, spacing: 0) {
            macOSWorklistHeader
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 12)
            if let presentation = model.conflictPresentation {
                conflictBanner(presentation)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
            patientSearchControls
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            Divider()
            macOSPatientList
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Elenco pazienti")
        #else
        // One container, so a surface applied by the caller wraps the whole
        // worklist. As a bare ViewBuilder sequence every top-level element
        // received the caller's padding and background separately, which drew
        // the list as a stack of loose cards instead of one list.
        VStack(alignment: .leading, spacing: Self.mobileStackSpacing) {
            // @Codex: A named collection, followed directly by its filters and rows.
            if verticalSizeClass != .compact {
                HStack(alignment: .firstTextBaseline) {
                    Text("Pazienti")
                        .font(.title2.weight(.semibold))
                        .accessibilityHeading(.h1)
                    Spacer(minLength: 8)
                    mobileResultCount
                }
            }
            worklistContent
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Elenco pazienti")
        #endif
    }

    #if !os(macOS)
    /// Spacing of the mobile worklist stack, shared by the outer stack and by
    /// the patient rows so the two cannot drift apart.
    private static let mobileStackSpacing: CGFloat = 16

    /* @Codex: In a short viewport the navigation bar owns the title, while
       the result count shares the filter row without reducing its touch area. */
    @ViewBuilder
    private var mobileResultCount: some View {
        if !model.patients.isEmpty || model.connectionState == .pairedOnline {
            Text("\(filteredPatients.count)")
                .font(.headline)
                .monospacedDigit()
                .fixedSize()
                .padding(.vertical, 2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(filteredPatients.count) pazienti visibili nell'elenco caricato")
                .accessibilityIdentifier("patient-worklist-count")
        }
    }
    #endif

    #if os(macOS)
    /* @Codex */
    private var macOSWorklistHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Pazienti")
                .font(.title2.weight(.semibold))
                .accessibilityHeading(.h1)
                .accessibilityIdentifier("patient-worklist-title")
            Spacer(minLength: 8)
            // A count describes the loaded, filtered rows, never the host total.
            // An unread empty array must not announce an empty patient archive.
            if !model.patients.isEmpty || model.connectionState == .pairedOnline {
                Text("\(filteredPatients.count)")
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    // @Codex: the filtered result can contain exactly one patient.
                    .accessibilityLabel(filteredPatients.count == 1
                        ? "1 paziente visibile nell'elenco caricato"
                        : "\(filteredPatients.count) pazienti visibili nell'elenco caricato")
                    .help("Risultati nell'elenco caricato, dopo ricerca e filtro di stato.")
                    .accessibilityIdentifier("patient-worklist-count")
            }
        }
    }

    /// The list portion of the Mac column: everything the banner, the filters and
    /// the heading already own is deliberately absent here.
    @ViewBuilder
    private var macOSPatientList: some View {
        worklistContent
    }
    #endif

    @ViewBuilder
    private var worklistContent: some View {
        #if !os(macOS)
        if let presentation = model.conflictPresentation {
            conflictBanner(presentation)
        }
        #endif
        if model.isWorking && model.patients.isEmpty {
            ProgressView()
                .worklistPlaceholder()
        } else if model.patients.isEmpty {
            Text("Nessun paziente caricato.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .worklistPlaceholder()
        } else {
            // macOS hoists the filters above the list, so the column keeps them
            // in place while the list scrolls.
            #if !os(macOS)
            patientSearchControls
            #endif
            let results = filteredPatients
            if results.isEmpty {
                Text(patientViewMode == .trash ? "Nessun paziente nel cestino." : "Nessun paziente per questi filtri.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .worklistPlaceholder()
                    .accessibilityIdentifier("patient-search-empty")
            } else {
                let rows = ForEach(results) { patient in
                    if patientViewMode == .trash {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text("\(patient.lastName) \(patient.firstName)")
                                        .font(.subheadline.weight(.semibold))
                                    PairedPatientFlagChip("Nel cestino", tone: .attention)
                                }
                                HStack(spacing: 6) {
                                    Text(PairedPatientsWorkspaceSupport.compactTaxCode(patient.taxCode))
                                        .font(.caption)
                                        .registro()
                                        .foregroundStyle(.secondary)
                                    if let deletedAt = patient.deletedAt {
                                        Text("Eliminato il \(PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: deletedAt))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                if let reason = cleanedPatientWorkspaceValue(patient.deletionReason) {
                                    Text("Motivo: \(reason)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if model.canRestorePatient(patient) {
                                Button {
                                    Task { await model.restorePatient(patient) }
                                } label: {
                                    Label("Ripristina", systemImage: "arrow.uturn.backward.circle")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("restore-patient-button-\(patient.id)")
                            }
                        }
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            PlatformColors.chartCardSurface,
                            in: RoundedRectangle(cornerRadius: ClinicalChartMetrics.rowRadius, style: .continuous)
                        )
                        .accessibilityIdentifier("patient-trash-row-\(patient.id)")
                    } else {
                        #if os(macOS)
                        // The selectable affordance is the system's own list
                        // selection shape, not a border drawn per row: sixty
                        // permanently outlined rows would be card soup and would
                        // destroy the alignment that makes a worklist scannable.
                        // What the row owes is a full-width hit area, room for
                        // that shape to breathe, and the selected trait, which
                        // was stated on iOS but missing here.
                        activePatientLabel(patient)
                            .modifier(WorklistRowHover())
                            .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8))
                            .tag(patient.id)
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(model.selectedPatientID == patient.id ? .isSelected : [])
                            .accessibilityIdentifier("patient-cell-\(patient.id)")
                        #else
                        Button {
                            guard model.canChangePatientSelection else { return }
                            if let onOpenPatient {
                                onOpenPatient(patient)
                            } else {
                                Task { await model.loadPatient(patient) }
                            }
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                activePatientLabel(patient)
                                Image(systemName: "chevron.right")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 4)
                                    .accessibilityHidden(true)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 14)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.canChangePatientSelection)
                        // @Codex: Flat, separated records; selection is still model-owned.
                        .background(model.selectedPatientID == patient.id ? Color.accentColor.opacity(0.10) : .clear)
                        .overlay(alignment: .bottom) { Divider() }
                        .accessibilityAddTraits(model.selectedPatientID == patient.id ? .isSelected : [])
                        .accessibilityIdentifier("patient-cell-\(patient.id)")
                        #endif
                    }
                }
                #if os(macOS)
                rows.modifier(
                    NativePatientSelectionListModifier(
                        selection: patientSelection,
                        isEnabled: model.canChangePatientSelection,
                        allowsSelection: patientViewMode != .trash
                    )
                )
                #else
                // The rows own their own spacing, so row-to-row separation stays
                // fixed regardless of what the outer worklist stack does with the
                // controls above it.
                VStack(alignment: .leading, spacing: 0) {
                    rows
                }
                #endif
            }
        }
    }

    /* @Codex */
    private var patientSelection: Binding<String?> {
        Binding(
            get: { model.selectedPatientID },
            set: { patientID in
                guard patientViewMode != .trash,
                      let patientID,
                      model.canChangePatientSelection,
                      let patient = filteredPatients.first(where: { $0.id == patientID }),
                      patientID != model.selectedPatientID || model.selectedPatient == nil else {
                    return
                }
                Task { await model.loadPatient(patient) }
            }
        )
    }

    @ViewBuilder
    private func activePatientLabel(_ patient: HomeBasePatientSummary) -> some View {
        #if os(macOS)
        // @Codex: Give identity the full first line in a 280–340 pt sidebar.
        // Recency shares the metadata line, leaving diagnosis its own third line.
        VStack(alignment: .leading, spacing: 5) {
            patientName(patient)
            if dynamicTypeSize.isAccessibilitySize {
                patientMetadata(patient)
                patientUpdate(patient, alignment: .leading)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    patientMetadata(patient)
                        .layoutPriority(1)
                    Spacer(minLength: 4)
                    patientUpdate(patient, alignment: .trailing)
                }
            }
            patientDiagnosis(patient)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        #else
        if dynamicTypeSize.isAccessibilitySize {
            // @Codex: Keep clinical context visible with scaled text. A single
            // wrapping summary avoids separate code, description and count rows.
            VStack(alignment: .leading, spacing: 6) {
                patientName(patient)
                patientMetadata(patient)
                accessibilityPatientDiagnosis(patient)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        } else if verticalSizeClass == .compact {
            // @Codex: Ordinary text in a short viewport keeps the identity-only
            // row; accessibility text retains its clinical summary above.
            VStack(alignment: .leading, spacing: 6) {
                patientName(patient)
                patientMetadata(patient)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        } else {
            // Three lines, each with a fixed job, and nothing that moves between
            // rows.
            //
            // The row used to flow: the ADI chip sat after the name, so its x
            // depended on how long that name was — measured across four rendered
            // rows it landed at 103, 163, 203 and 224 points. A marker that moves
            // is not scanned, it is hunted, and it moved at exactly the moment the
            // eye was reading the name. The diagnosis wrapped, so row heights
            // varied continuously and the column of names lost its rhythm; "+1"
            // landed after the wrap, reading as part of the diagnosis text; and
            // the recency floated at the vertical centre of a block whose height
            // changed per patient.
            //
            // Now: the name owns the first line with the recency pinned to its
            // baseline, the flags open the second line at a fixed x, and the
            // clinical line is one line that truncates. Row height becomes
            // discrete rather than continuous.
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    patientName(patient)
                    Spacer(minLength: 8)
                    patientUpdate(patient, alignment: .trailing)
                }
                patientMetadata(patient)
                patientDiagnosis(patient)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        #endif
    }

    /// The name alone. It wraps rather than truncates — a patient's name is not
    /// an email subject — but it no longer shares its line with a chip.
    private func patientName(_ patient: HomeBasePatientSummary) -> some View {
        Text("\(patient.lastName) \(patient.firstName)")
            #if os(macOS)
            .font(.body.weight(.semibold))
            #else
            .chartRowTitle()
            #endif
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
    }


    /// The identity line, and the only place a care-category flag appears.
    ///
    /// The flag opens the line, so it is always at the same x and a column of ADI
    /// patients can be read at a glance. "Archiviato" is gone from here entirely:
    /// `PatientsFiltering` is exclusive — the Attivi tab shows `isArchived != true`
    /// and the Archiviati tab shows `isArchived == true` — so that chip could only
    /// ever appear in the tab where *every* row has it. A label repeated on every
    /// visible row carries no information; the tab already said it.
    ///
    /// Age before the tax code: the age is the human fact and the one that
    /// disambiguates two patients with the same name at a glance. The masked code
    /// is a matching tool, so it goes second and stays quiet.
    private func patientMetadata(_ patient: HomeBasePatientSummary) -> some View {
        HStack(spacing: 6) {
            #if os(macOS)
            let isSelectedRow = model.selectedPatientID == patient.id
            #else
            let isSelectedRow = false
            #endif
            if patient.isAdi == true {
                PairedPatientFlagChip("ADI", tone: .info, isOnProminentBackground: isSelectedRow)
            }
            if let age = PairedPatientsWorkspaceSupport.age(from: patient.birthDate) {
                Text("\(age) anni")
                    .font(.caption)
                    .registro()
                    .accessibilityIdentifier("patient-cell-age-\(patient.id)")
                Text("·")
                    .font(.caption)
            }
            Text(PairedPatientsWorkspaceSupport.compactTaxCode(patient.taxCode))
                .font(.caption)
                .registro()
        }
        .lineLimit(1)
        // @Codex
        .lumeInchiostro(bozza: true)
    }

    #if os(iOS)
    /* @Codex */
    @ViewBuilder
    private func accessibilityPatientDiagnosis(_ patient: HomeBasePatientSummary) -> some View {
        if let summary = PatientWorklistDiagnosisSummary(rawDiagnoses: patient.diagnoses) {
            Text(summary.additionalCount > 0
                 ? "\(summary.displayText)  +\(summary.additionalCount)"
                 : summary.displayText)
                .font(.caption)
                .lineLimit(2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
                .lumeInchiostro(bozza: true)
                .accessibilityLabel(summary.additionalCount > 0
                    ? "\(summary.displayText). \(summary.additionalAccessibilityLabel)"
                    : summary.displayText)
                .accessibilityIdentifier("patient-cell-diagnosis-\(patient.id)")
        }
    }
    #endif

    /* @Codex */
    @ViewBuilder
    private func patientDiagnosis(_ patient: HomeBasePatientSummary) -> some View {
        if let summary = PatientWorklistDiagnosisSummary(rawDiagnoses: patient.diagnoses) {
            // At accessibility sizes the wrapped diagnosis and a trailing "+N"
            // drift apart across lines, so the count moves under the text.
            // One line, truncated, with the count pinned to the trailing edge.
            //
            // This used to wrap to two lines with the count concatenated at the
            // end of the text. That kept the count out of the middle of a
            // sentence, but it bought the fix with the list's rhythm: every
            // patient whose diagnosis ran long made their row taller than their
            // neighbours', so scanning a column of sixty names meant re-finding
            // the baseline on each one. In a worklist the diagnosis is context —
            // it says why this patient matters, not what to do about them — and
            // the full text is one tap away in the chart. So the line gives up
            // its tail rather than the column giving up its rhythm.
            //
            // Accessibility sizes still wrap: there the row count is small, the
            // text is large, and losing the diagnosis would cost more than the
            // rhythm is worth.
            let stacksAtAccessibilitySize = dynamicTypeSize >= .accessibility1
            let layout = stacksAtAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 6))
            layout {
                if !summary.code.isEmpty {
                    diagnosisCodePill(summary.code, patient: patient)
                }
                if !summary.descriptionText.isEmpty {
                    Text(summary.descriptionText)
                        .lineLimit(stacksAtAccessibilitySize ? 3 : 1)
                        .truncationMode(.tail)
                        .fixedSize(horizontal: false, vertical: stacksAtAccessibilitySize)
                }
                if !stacksAtAccessibilitySize {
                    Spacer(minLength: 4)
                }
                if summary.additionalCount > 0 {
                    Text("+\(summary.additionalCount)")
                        .fontWeight(.medium)
                        .fixedSize()
                }
            }
            .font(.caption)
            // @Codex
            .lumeInchiostro(bozza: true)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                summary.additionalCount > 0
                    ? "\(summary.displayText). \(summary.additionalAccessibilityLabel)"
                    : summary.displayText
            )
            .accessibilityIdentifier("patient-cell-diagnosis-\(patient.id)")
        }
    }

    /// @Codex: Native selection owns both ink and background on the Mac row.
    /// A separate light chip made the dark-mode code disappear when selected.
    private func diagnosisCodePill(_ code: String, patient: HomeBasePatientSummary) -> some View {
        #if os(macOS)
        Text(code)
            .font(.caption.weight(.semibold))
            .registro()
            .foregroundStyle(.primary)
            .fixedSize()
        #else
        ClinicalCodePill(code)
        #endif
    }

    /// "  +2", or nothing. A `Text` so it can be concatenated into the
    /// description and stay inside its text flow.
    private func additionalCountSuffix(_ summary: PatientWorklistDiagnosisSummary) -> Text {
        guard summary.additionalCount > 0 else { return Text("") }
        return Text("  +\(summary.additionalCount)").fontWeight(.medium)
    }

    private func patientUpdate(_ patient: HomeBasePatientSummary, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            if let updated = patient.updatedAt {
                Text(PairedPatientsWorkspaceSupport.relativeUpdated(updated))
                    .font(.caption2)
                    .registro()
                    // @Codex
                    .lumeInchiostro(bozza: false)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("patient-cell-updated-\(patient.id)")
            }
        }
    }

    private var filteredPatients: [HomeBasePatientSummary] {
        PatientsFiltering.apply(
            patients: model.patients,
            query: patientQuery,
            viewMode: patientViewMode,
            sortMode: patientSortMode
        )
    }


    private var patientSearchControls: some View {
        #if os(macOS)
        // @Codex: Search stays in the workspace toolbar; local controls use
        // standard native styles without an additional material container.
        macOSFilterCluster
        #else
        // Mobile keeps only the scope control in the scrolling content. Search is
        // a system search field in the navigation bar and sort is a toolbar menu,
        // so neither spends height above the first patient.
        HStack(spacing: 12) {
            patientViewModePicker
                .frame(maxWidth: .infinity, alignment: .leading)
            if verticalSizeClass == .compact { mobileResultCount }
        }
        #endif
    }

    #if os(macOS)
    /* @Codex */
    private var macOSFilterCluster: some View {
        VStack(alignment: .leading, spacing: 10) {
            patientViewModePicker
                .controlSize(.regular)
                .frame(maxWidth: .infinity, alignment: .leading)
            // The scope gets a whole row; sort and reset share the second only
            // while both fit, so neither compresses the segmented control.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    patientSortMenu
                    Spacer(minLength: 8)
                    resetFiltersButton
                }
                VStack(alignment: .leading, spacing: 8) {
                    patientSortMenu
                    resetFiltersButton
                }
            }
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    @ViewBuilder
    private var resetFiltersButton: some View {
        if isFilteringActive {
            Button("Azzera") {
                patientQuery = ""
                patientViewMode = .active
                patientSortMode = .recent
            }
            .buttonStyle(.bordered)
            .fixedSize()
            .help("Azzera ricerca, stato e ordine")
            .accessibilityIdentifier("patient-filters-reset")
        }
    }

    private var isFilteringActive: Bool {
        !patientQuery.isEmpty || patientViewMode != .active || patientSortMode != .recent
    }
    #endif


    /* @Codex */
    @ViewBuilder
    private var patientViewModePicker: some View {
        // A segmented control divides its width equally and truncates; it never
        // wraps. At accessibility sizes the same Picker becomes a menu so the
        // scope label reflows instead of clipping.
        let picker = Picker("Stato", selection: $patientViewMode) {
            Text("Attivi").tag(PatientListViewMode.active)
            Text("Archiviati").tag(PatientListViewMode.archived)
            Text("Cestino").tag(PatientListViewMode.trash)
        }
        if dynamicTypeSize.isAccessibilitySize {
            picker
                .pickerStyle(.menu)
                .accessibilityIdentifier("patient-view-mode")
        } else {
            picker
                .pickerStyle(.segmented)
                #if os(macOS)
                // The segments name the scope themselves. Shown, the "Stato"
                // label wrapped to two lines in a narrow list column and pushed
                // the control out of alignment with the sort row. Hiding the
                // label keeps it for VoiceOver.
                .labelsHidden()
                #endif
                .accessibilityIdentifier("patient-view-mode")
        }
    }

    #if os(macOS)
    /* @Codex */
    private var patientSortMenu: some View {
        // A menu-style Picker states the active order on its own face. The
        // previous Menu showed a bare pair of arrows: the current sort was only
        // discoverable by opening it, and VoiceOver announced no value.
        Picker("Ordina", selection: $patientSortMode) {
            Text("Recenti").tag(PatientListSortMode.recent)
            Text("Alfabetico").tag(PatientListSortMode.alpha)
        }
        .pickerStyle(.menu)
        .accessibilityValue(patientSortMode == .recent ? "Recenti" : "Alfabetico")
        .accessibilityIdentifier("patient-sort-menu")
    }
    #endif

    @ViewBuilder

    private func conflictBanner(_ presentation: VersionConflictPresentation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Identifier on the leaf title (not the container) so the inner buttons
            // stay individually queryable instead of collapsing into one element.
            Label(presentation.title, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("version-conflict-banner")
            Text(presentation.detail)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Ricarica i dati aggiornati") {
                    Task { await model.reloadAfterConflict() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)
                .accessibilityIdentifier("reload-after-conflict-button")
                Button("Ignora") {
                    model.dismissConflict()
                }
                .accessibilityIdentifier("dismiss-conflict-button")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.orange.opacity(0.4)))
    }

    // Plain tinted capsule (no glass): glass inside the glass card would nest.
}

/* @Codex */
struct PatientWorklistDiagnosisSummary: Equatable {
    let displayText: String
    /// The code on its own, so the row can set it as a pill instead of running
    /// it into the description behind a hyphen. A code is matched at a glance;
    /// a description is read. Typeset identically, neither job is served.
    let code: String
    /// The description on its own. Empty when the diagnosis carries only a code.
    let descriptionText: String
    let additionalCount: Int

    init?(rawDiagnoses: String?) {
        let diagnoses = DiagnosesCodec.decode(rawDiagnoses)
        guard let first = diagnoses.first, !first.displayText.isEmpty else { return nil }
        displayText = first.displayText
        code = first.code
        descriptionText = first.description
        additionalCount = max(0, diagnoses.count - 1)
    }

    var additionalAccessibilityLabel: String {
        additionalCount == 1
            ? "Un'altra diagnosi registrata"
            : "Altre \(additionalCount) diagnosi registrate"
    }
}

/* @Codex */
private struct NativePatientSelectionListModifier: ViewModifier {
    @Binding var selection: String?
    let isEnabled: Bool
    let allowsSelection: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(macOS)
        if allowsSelection {
            List(selection: $selection) {
                content
            }
            .listStyle(.sidebar)
            .worklistTranslucentBackground()
            .disabled(!isEnabled)
            .accessibilityLabel("Elenco pazienti")
            .accessibilityIdentifier("patients-selection-list")
        } else {
            List {
                content
            }
            .listStyle(.sidebar)
            .worklistTranslucentBackground()
            .disabled(!isEnabled)
            .accessibilityLabel("Cestino pazienti")
            .accessibilityIdentifier("patients-trash-list")
        }
        #else
        content
        #endif
    }
}


#if os(macOS)
private extension View {
    /// Lets the window's sidebar material show through the worklist.
    ///
    /// A `.sidebar` List inside a split pane paints `controlBackgroundColor`, so
    /// the patient list sat on a flat opaque grey while every other surface in
    /// the app is either a translucent material or a rounded island on one. The
    /// grey is what made the column read as a control panel bolted to the side
    /// rather than part of the same document. Hiding the list's own fill hands
    /// the background back to the window, which is where a sidebar's material
    /// belongs.
    @ViewBuilder
    func worklistTranslucentBackground() -> some View {
        if #available(macOS 14.0, *) {
            scrollContentBackground(.hidden)
                .background(PlatformColors.groupedBackground)
        } else {
            self
        }
    }
}

/// Tells the pointer the row is live before it is clicked. A list whose rows
/// only react on selection feels inert under the cursor, and on a worklist the
/// pointer is how a clinician explores before committing to open a chart.
private struct WorklistRowHover: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            // @Codex: Separate adjacent records without adding another card.
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: ClinicalChartMetrics.rowRadius, style: .continuous)
                    .fill(Color.secondary.opacity(isHovering ? 0.10 : 0))
            )
            .contentShape(Rectangle())
            .onHover { isHovering = $0 }
            // A hover tint that snaps is noise; one that eases reads as response.
            .animation(.easeOut(duration: 0.12), value: isHovering)
    }
}
#endif

private extension View {
    /// Centres a worklist placeholder in the Mac column instead of leaving it
    /// hanging under the filters. Mobile keeps the inline flow it already had.
    @ViewBuilder
    func worklistPlaceholder() -> some View {
        #if os(macOS)
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 12)
        #else
        self
        #endif
    }
}

/* @Codex */
struct PairedPatientCreateView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nome", text: $model.newPatientFirstName)
                        .accessibilityIdentifier("new-patient-first-name")
                    TextField("Cognome", text: $model.newPatientLastName)
                        .accessibilityIdentifier("new-patient-last-name")
                    TextField("Codice fiscale", text: $model.newPatientTaxCode)
                        .accessibilityIdentifier("new-patient-tax-code")
                }
                Section {
                    Toggle("Data di nascita", isOn: $model.newPatientHasBirthDate)
                        .accessibilityIdentifier("new-patient-has-birth-date")
                    if model.newPatientHasBirthDate {
                        DatePicker("Nascita", selection: $model.newPatientBirthDate, displayedComponents: .date)
                            .accessibilityIdentifier("new-patient-birth-date")
                    }
                    TextField("Indirizzo (opzionale)", text: $model.newPatientAddress)
                        .accessibilityIdentifier("new-patient-address")
                    TextField("Telefono (opzionale)", text: $model.newPatientPhone)
                        .accessibilityIdentifier("new-patient-phone")
                    TextField("Caregiver (opzionale)", text: $model.newPatientCaregiver)
                        .accessibilityIdentifier("new-patient-caregiver")
                }
                Text("Crea in locale quando l'autorità on-device è attiva, oppure tramite l'home-base collegato se il permesso è concesso. Richiede il PIN operatore per cifrare i campi.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Nuovo paziente")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { model.cancelCreatingPatient() }
                        .accessibilityIdentifier("cancel-new-patient-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crea") { Task { await model.createPatient() } }
                        .disabled(!model.canCreatePatient)
                        .accessibilityIdentifier("create-patient-button")
                }
            }
        }
    }

}
