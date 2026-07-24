import SwiftUI

/* @Codex */
struct PairedHomeBaseCredentialsView: View {
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
            if !model.availableAmbulatories.isEmpty {
                Menu {
                    ForEach(model.availableAmbulatories) { ambulatory in
                        Button(ambulatory.name) {
                            model.selectAmbulatory(ambulatory.id)
                        }
                    }
                } label: {
                    Label(activeAmbulatoryLabel, systemImage: "building.2")
                        .font(.caption)
                }
                .accessibilityIdentifier("ambulatory-scope-picker")
            }
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


    private var activeAmbulatoryLabel: String {
        if let match = model.availableAmbulatories.first(where: { $0.id == model.ambulatoryId }) {
            return "Scope: \(match.name)"
        }
        return model.ambulatoryId.isEmpty ? "Seleziona ambulatorio" : "Scope: \(model.ambulatoryId)"
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

/* @Codex */
struct PairedPatientsWorklistView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var patientQuery: String
    @Binding var patientViewMode: PatientListViewMode
    @Binding var patientSortMode: PatientListSortMode

    @ViewBuilder
    var body: some View {
        Text("Pazienti")
            .font(.headline)
            .accessibilityHeading(.h2)
        if let presentation = model.conflictPresentation {
            conflictBanner(presentation)
        }
        Button {
            model.startCreatingPatient()
        } label: {
            Label("Nuovo paziente", systemImage: "person.badge.plus")
        }
        .font(.caption)
        .disabled(model.isWorking)
        .accessibilityIdentifier("new-patient-button")
        if model.isWorking && model.patients.isEmpty {
            ProgressView()
        } else if model.patients.isEmpty {
            Text("Nessun paziente caricato.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            patientSearchControls
            let results = filteredPatients
            if results.isEmpty {
                Text(patientViewMode == .trash ? "Nessun paziente nel cestino." : "Nessun paziente per questi filtri.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
                        .lumeSurface(zone: model.selectedPatient?.id == patient.id ? .focal : .field, cornerRadius: 10)
                        .accessibilityIdentifier("patient-trash-row-\(patient.id)")
                    } else {
                        #if os(macOS)
                        activePatientLabel(patient)
                            .tag(patient.id)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("patient-cell-\(patient.id)")
                        #else
                        Button {
                            Task { await model.loadPatient(patient) }
                        } label: {
                            activePatientLabel(patient)
                        }
                        .buttonStyle(.plain)
                        .modifier(LumeRigaListaModifier(isSelected: model.selectedPatient?.id == patient.id))
                        .accessibilityAddTraits(model.selectedPatient?.id == patient.id ? .isSelected : [])
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
                rows
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
        if dynamicTypeSize >= .accessibility1 {
            VStack(alignment: .leading, spacing: 6) {
                patientIdentity(patient)
                patientMetadata(patient)
                patientUpdate(patient, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        } else {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    patientIdentity(patient)
                    patientMetadata(patient)
                }
                Spacer(minLength: 8)
                patientUpdate(patient, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
    }

    private func patientIdentity(_ patient: HomeBasePatientSummary) -> some View {
        HStack(spacing: 6) {
            Text("\(patient.lastName) \(patient.firstName)")
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            if patient.isAdi == true { PairedPatientFlagChip("ADI", tone: .info) }
            if patient.isArchived == true { PairedPatientFlagChip("Archiviato", tone: .neutral) }
        }
    }

    private func patientMetadata(_ patient: HomeBasePatientSummary) -> some View {
        HStack(spacing: 6) {
            Text(PairedPatientsWorkspaceSupport.compactTaxCode(patient.taxCode))
                .font(.caption)
                .registro()
                .foregroundStyle(.secondary)
            if let age = PairedPatientsWorkspaceSupport.age(from: patient.birthDate) {
                Text("· \(age) anni")
                    .font(.caption)
                    .registro()
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("patient-cell-age-\(patient.id)")
            }
        }
    }

    private func patientUpdate(_ patient: HomeBasePatientSummary, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            if let updated = patient.updatedAt {
                Text(PairedPatientsWorkspaceSupport.relativeUpdated(updated))
                    .font(.caption2)
                    .registro()
                    .foregroundStyle(.tertiary)
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
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Cerca per nome o codice fiscale", text: $patientQuery)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("patient-search-field")
                if !patientQuery.isEmpty {
                    Button {
                        patientQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("patient-search-clear")
                }
            }
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    patientViewModePicker
                    patientSortMenu
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 10) {
                    patientViewModePicker
                    patientSortMenu
                }
            }
        }
    }

    /* @Codex */
    private var patientViewModePicker: some View {
        Picker("Stato", selection: $patientViewMode) {
            Text("Attivi").tag(PatientListViewMode.active)
            Text("Archiviati").tag(PatientListViewMode.archived)
            Text("Cestino").tag(PatientListViewMode.trash)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("patient-view-mode")
    }

    /* @Codex */
    private var patientSortMenu: some View {
        Menu {
            Picker("Ordina", selection: $patientSortMode) {
                Text("Recenti").tag(PatientListSortMode.recent)
                Text("Alfabetico").tag(PatientListSortMode.alpha)
            }
        } label: {
            Label("Ordina", systemImage: "arrow.up.arrow.down")
        }
        .accessibilityLabel("Ordina pazienti")
        .accessibilityIdentifier("patient-sort-menu")
    }

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
            .disabled(!isEnabled)
            .accessibilityLabel("Elenco pazienti")
            .accessibilityIdentifier("patients-selection-list")
        } else {
            List {
                content
            }
            .listStyle(.sidebar)
            .disabled(!isEnabled)
            .accessibilityLabel("Cestino pazienti")
            .accessibilityIdentifier("patients-trash-list")
        }
        #else
        content
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
