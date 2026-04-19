import Charts
import SwiftUI

struct OncologyPrototypeRootView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    @Namespace private var liquidNamespace
    @State private var patientQuery = ""
    @State private var trackFilter: OncologyTrack?
    @State private var showingNewPatientSheet = false
    @State private var showingSettingsSheet = false
    @State private var draft = NewPatientDraft()

    var body: some View {
        ZStack {
            PrototypeSceneBackground()

            NavigationSplitView {
                sidebar
                    .navigationSplitViewColumnWidth(min: 250, ideal: 290, max: 320)
            } content: {
                contentColumn
                    .navigationTitle(contentTitle)
                    .navigationSplitViewColumnWidth(min: 380, ideal: 460, max: 540)
            } detail: {
                detailColumn
                    .navigationSplitViewColumnWidth(min: 560, ideal: 760, max: 980)
            }
        }
        .sheet(isPresented: $showingNewPatientSheet) {
            NewPatientSheet(
                draft: $draft,
                onCancel: { showingNewPatientSheet = false },
                onSubmit: {
                    store.addPatient(from: draft)
                    draft = NewPatientDraft()
                    showingNewPatientSheet = false
                }
            )
        }
        .sheet(isPresented: $showingSettingsSheet) {
            PrototypeSettingsSheet(isPresented: $showingSettingsSheet)
                .environmentObject(store)
        }
        .sheet(isPresented: $store.showOnboarding) {
            PrototypeOnboardingView()
                .environmentObject(store)
                .interactiveDismissDisabled()
        }
        .toolbar {
            ToolbarItemGroup {
                Button("Nuovo caso") {
                    draft = NewPatientDraft()
                    showingNewPatientSheet = true
                }
                .prototypePrimaryAction()

                Button("Avanza step") {
                    store.advanceSelectedPatient()
                }
                .disabled(store.selectedPatient == nil || !store.currentRole.canAdvancePathway)
                .prototypeSecondaryAction()

                Menu("Simula") {
                    Button("Prestazione incongrua") {
                        store.injectInvalidBookingOnSelectedPatient()
                    }
                    .disabled(store.selectedPatient == nil)

                    Button("Referto disponibile") {
                        store.simulateReportArrivalOnSelectedPatient()
                    }
                    .disabled(store.selectedPatient == nil)

                    Divider()

                    Button("Giornata operativa") {
                        store.simulateOperationalDay()
                    }
                }

                Button("Impostazioni") {
                    showingSettingsSheet = true
                }
                .prototypeSecondaryAction()

                Button("Onboarding") {
                    store.reopenOnboarding()
                }
                .prototypeSecondaryAction()
            }
        }
    }

    private var contentTitle: String {
        switch store.selectedArea {
        case .dashboard:
            return "Casi monitorati"
        case .patients:
            return "Registry pazienti"
        case .inbox:
            return "Segnalazioni aperte"
        case .operations:
            return "Controllo operations"
        }
    }

    private var filteredPatients: [PatientCase] {
        store.filteredPatients(query: patientQuery, track: trackFilter)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            List(selection: selectedAreaBinding) {
                Section("Aree") {
                    ForEach(PrototypeArea.allCases) { area in
                        Label(area.title, systemImage: area.systemImage)
                            .tag(area)
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()

            VStack(alignment: .leading, spacing: 14) {
                PrototypeGlassGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Persona attiva")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Picker("Persona attiva", selection: $store.currentRole) {
                            ForEach(PrototypeRole.allCases) { role in
                                Text(role.title).tag(role)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)

                        HStack(spacing: 8) {
                            StatusBadge(text: store.currentRole.title, tint: .blue)
                            StatusBadge(text: store.settings.intelligenceMode.title, tint: .teal)
                        }

                        Text(store.currentRole.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .prototypeHero(tint: .white.opacity(0.08))
                }

                InfoCard(title: "Focus", systemImage: "sparkles") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(roleFocusLine)
                            .font(.subheadline.weight(.medium))
                        Text("Modalita \(store.settings.intelligenceMode.title.lowercased()), congestione \(Int(store.settings.operationalCongestion * 100))%.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Button("Simula giornata operativa") {
                    store.simulateOperationalDay()
                }
                .prototypePrimaryAction()

                Button("Reset demo") {
                    store.resetDemo()
                }
                .prototypeSecondaryAction()
            }
            .padding(16)
        }
    }

    private var contentColumn: some View {
        Group {
            switch store.selectedArea {
            case .inbox:
                InboxTableView(
                    alerts: store.pendingAlerts,
                    selection: alertSelectionBinding
                )
            case .dashboard, .patients, .operations:
                PatientsTableView(
                    patients: filteredPatients,
                    selection: patientSelectionBinding,
                    patientQuery: $patientQuery,
                    trackFilter: $trackFilter
                )
            }
        }
    }

    @ViewBuilder
    private var detailColumn: some View {
        switch store.selectedArea {
        case .dashboard:
            DashboardOverviewView(selectedPatient: store.selectedPatient)
                .environmentObject(store)
        case .patients:
            if let patient = store.selectedPatient {
                PatientWorkspaceView(patient: patient)
                    .environmentObject(store)
            } else {
                PlaceholderDetailView(
                    title: "Seleziona un paziente",
                    subtitle: "Apri una scheda per consulto, checklist, referral e stato del protocollo."
                )
            }
        case .inbox:
            if let alert = store.selectedAlert,
               let patient = store.selectedPatient {
                AlertDetailView(alert: alert, patient: patient)
                    .environmentObject(store)
            } else {
                PlaceholderDetailView(
                    title: "Inbox clinica",
                    subtitle: "Scegli un alert per vedere il paziente associato e la raccomandazione operativa."
                )
            }
        case .operations:
            OperationsBoardView(selectedPatient: store.selectedPatient)
                .environmentObject(store)
        }
    }

    private var patientSelectionBinding: Binding<PatientCase.ID?> {
        Binding(
            get: { store.selectedPatientID },
            set: { store.selectPatient($0) }
        )
    }

    private var alertSelectionBinding: Binding<ClinicalAlert.ID?> {
        Binding(
            get: { store.selectedAlertID },
            set: { store.selectAlert($0) }
        )
    }

    private var selectedAreaBinding: Binding<PrototypeArea?> {
        Binding(
            get: { store.selectedArea },
            set: { newValue in
                guard let newValue else { return }
                store.selectedArea = newValue
            }
        )
    }

    private var roleFocusLine: String {
        switch store.currentRole {
        case .oncologist:
            return "Vista completa del percorso, consulto sintetico e guardrail clinici."
        case .generalPractitioner:
            return "Tracciamento referral e stato del paziente lungo il protocollo."
        case .adminOperator:
            return "Monitoraggio agenda, colli di bottiglia e storico prestazioni."
        }
    }
}

private struct PatientsTableView: View {
    let patients: [PatientCase]
    @Binding var selection: PatientCase.ID?
    @Binding var patientQuery: String
    @Binding var trackFilter: OncologyTrack?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                TextField("Cerca paziente, diagnosi o nodo", text: $patientQuery)
                    .textFieldStyle(.roundedBorder)

                Picker("Percorso", selection: $trackFilter) {
                    Text("Tutti i percorsi").tag(Optional<OncologyTrack>.none)
                    ForEach(OncologyTrack.allCases) { track in
                        Text(track.shortTitle).tag(Optional(track))
                    }
                }
                .pickerStyle(.menu)
                .frame(width: 180)
            }

            Table(patients, selection: $selection) {
                TableColumn("Paziente") { patient in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(patient.fullName)
                                .font(.headline)
                            StatusBadge(text: patient.track.shortTitle, tint: trackTint(patient.track))
                        }
                        Text(patient.confirmedCondition)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .width(min: 220, ideal: 260)

                TableColumn("Nodo attuale") { patient in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(patient.currentStep?.title ?? "Follow-up")
                        Text(patient.currentLocation)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .width(min: 160, ideal: 200)

                TableColumn("Alert") { patient in
                    if let alert = patient.unresolvedAlerts.first {
                        StatusBadge(text: alert.title, tint: severityTint(alert.severity))
                    } else {
                        Text("Nessuno")
                            .foregroundStyle(.secondary)
                    }
                }
                .width(min: 120, ideal: 150)

                TableColumn("Protocollo") { patient in
                    if let protocolState = patient.therapyProtocol {
                        Text("Ciclo \(protocolState.currentCycle)/\(protocolState.totalCycles)")
                    } else {
                        Text("Non avviato")
                            .foregroundStyle(.secondary)
                    }
                }
                .width(min: 100, ideal: 110)

                TableColumn("Prossima scadenza") { patient in
                    Text(shortDate(patient.nextDueDate))
                }
                .width(min: 110, ideal: 120)
            }
        }
        .padding()
    }
}

private struct InboxTableView: View {
    let alerts: [ClinicalAlert]
    @Binding var selection: ClinicalAlert.ID?

    var body: some View {
        Table(alerts, selection: $selection) {
            TableColumn("Priorita") { alert in
                StatusBadge(text: alert.severity.rawValue.capitalized, tint: severityTint(alert.severity))
            }
            .width(min: 90, ideal: 100)

            TableColumn("Alert") { alert in
                VStack(alignment: .leading, spacing: 4) {
                    Text(alert.title)
                        .font(.headline)
                    Text(alert.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            .width(min: 260, ideal: 340)

            TableColumn("Owner") { alert in
                Text(alert.owner)
            }
            .width(min: 120, ideal: 130)

            TableColumn("Creato") { alert in
                Text(shortDateTime(alert.createdAt))
            }
            .width(min: 120, ideal: 140)
        }
        .padding()
    }
}

private struct DashboardOverviewView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    let selectedPatient: PatientCase?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Backbone clinico-organizzativa")
                        .font(.largeTitle.weight(.semibold))

                    Text("Prototipo nativo macOS per orientare il paziente oncologico lungo referral, workup, board, agenda e protocollo.")
                        .foregroundStyle(.secondary)
                }
                .prototypeHero(tint: .white.opacity(0.08))

                LazyVGrid(columns: [.init(.adaptive(minimum: 220), spacing: 16)], spacing: 16) {
                    ForEach(store.dashboardMetrics) { metric in
                        MetricCard(metric: metric)
                    }
                }

                if let selectedPatient {
                    InfoCard(title: "Focus paziente selezionato", systemImage: "scope") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(selectedPatient.fullName)
                                    .font(.headline)
                                Spacer()
                                StatusBadge(text: selectedPatient.track.shortTitle, tint: trackTint(selectedPatient.track))
                            }
                            Text(selectedPatient.currentStep?.title ?? "Follow-up")
                            Text(selectedPatient.boardRecommendation)
                                .foregroundStyle(.secondary)
                            PrototypeActionRow {
                                Button("Apri scheda") {
                                    store.selectedArea = .patients
                                }
                                .prototypePrimaryAction()

                                Button("Avanza") {
                                    store.advanceSelectedPatient()
                                }
                                .disabled(!store.currentRole.canAdvancePathway)
                                .prototypeSecondaryAction()
                            }
                        }
                    }
                }

                InfoCard(title: "Distribuzione dei casi", systemImage: "chart.bar.xaxis") {
                    Chart(store.chartBuckets) { bucket in
                        BarMark(
                            x: .value("Bucket", bucket.label),
                            y: .value("Casi", bucket.count)
                        )
                        .foregroundStyle(by: .value("Bucket", bucket.label))
                    }
                    .frame(height: 220)
                }

                InfoCard(title: "Hot queue", systemImage: "bolt.circle") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(store.pendingAlerts.prefix(4)) { alert in
                            HStack(alignment: .top, spacing: 12) {
                                StatusBadge(text: alert.severity.rawValue.capitalized, tint: severityTint(alert.severity))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(alert.title)
                                        .font(.headline)
                                    Text(alert.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
    }
}

private struct OperationsBoardView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    let selectedPatient: PatientCase?

    private var openBookings: [BookingItem] {
        store.allBookings.filter { $0.status != .completed }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Controllo operations")
                    .font(.largeTitle.weight(.semibold))

                Text("Vista per utenti non clinici o per coordinamento rapido dei colli di bottiglia.")
                    .foregroundStyle(.secondary)

                if let selectedPatient {
                    InfoCard(title: "Caso in osservazione operations", systemImage: "eye") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(selectedPatient.fullName)
                                    .font(.headline)
                                Spacer()
                                StatusBadge(text: selectedPatient.currentLocation, tint: .blue)
                            }
                            Text("Alert aperti: \(selectedPatient.unresolvedAlerts.count) • Prestazioni attive: \(selectedPatient.bookings.filter { $0.status != .completed }.count)")
                                .foregroundStyle(.secondary)
                            PrototypeActionRow {
                                Button("Apri inbox") {
                                    store.selectedArea = .inbox
                                }
                                .prototypePrimaryAction()

                                Button("Simula errore") {
                                    store.injectInvalidBookingOnSelectedPatient()
                                }
                                .prototypeSecondaryAction()
                            }
                        }
                    }
                }

                InfoCard(title: "Team demo", systemImage: "person.2.badge.gearshape") {
                    Table(store.operationsUsers) {
                        TableColumn("Utente") { user in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(user.name)
                                Text(user.focus)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        TableColumn("Ruolo") { user in
                            Text(user.role.title)
                        }
                        TableColumn("Open items") { user in
                            Text("\(user.openItems)")
                        }
                        TableColumn("Disponibilita") { user in
                            Text(user.availability)
                        }
                    }
                    .frame(height: 180)
                }

                InfoCard(title: "Prestazioni da gestire", systemImage: "calendar.badge.exclamationmark") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(openBookings, id: \.id) { booking in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(booking.label)
                                    Text("\(booking.location) • \(shortDateTime(booking.scheduledFor))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                StatusBadge(text: booking.status.rawValue, tint: booking.status == .invalid ? .red : .orange)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
    }
}

private struct AlertDetailView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    let alert: ClinicalAlert
    let patient: PatientCase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(alert.title)
                    .font(.largeTitle.weight(.semibold))

                HStack(spacing: 10) {
                    StatusBadge(text: alert.severity.rawValue.capitalized, tint: severityTint(alert.severity))
                    Text(patient.fullName)
                        .font(.headline)
                    Text(patient.track.shortTitle)
                        .foregroundStyle(.secondary)
                }

                InfoCard(title: "Dettaglio alert", systemImage: "exclamationmark.triangle") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(alert.detail)
                        Text("Owner: \(alert.owner) • Creato: \(shortDateTime(alert.createdAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                InfoCard(title: "Paziente associato", systemImage: "person.text.rectangle") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(patient.confirmedCondition)
                            .font(.headline)
                        Text(patient.currentStep?.title ?? "Follow-up")
                        Text(patient.boardRecommendation)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack {
                    Button("Apri scheda paziente") {
                        store.selectedArea = .patients
                    }
                    .prototypeSecondaryAction()

                    Button("Segna come risolto") {
                        store.resolveSelectedAlert()
                    }
                    .prototypePrimaryAction()
                }
            }
            .padding(24)
        }
    }
}

private struct PatientWorkspaceView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    let patient: PatientCase

    private var consultation: ConsultationBrief {
        store.consultation(for: patient)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(patient.fullName)
                            .font(.largeTitle.weight(.semibold))
                        HStack(spacing: 10) {
                            StatusBadge(text: patient.track.shortTitle, tint: trackTint(patient.track))
                            Text("\(patient.age) anni")
                                .foregroundStyle(.secondary)
                            Text(patient.currentLocation)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if let protocolState = patient.therapyProtocol {
                        VStack(alignment: .trailing, spacing: 8) {
                            Text(protocolState.name)
                                .font(.headline)
                            Text("Ciclo \(protocolState.currentCycle) / \(protocolState.totalCycles)")
                                .foregroundStyle(.secondary)
                            ProgressView(
                                value: Double(protocolState.currentCycle),
                                total: Double(protocolState.totalCycles)
                            )
                            .frame(width: 180)
                        }
                    }
                }
                .prototypeHero(tint: trackTint(patient.track).opacity(0.14))

                PrototypeActionRow {
                    Button("Avanza step") {
                        store.advanceSelectedPatient()
                    }
                    .disabled(!store.currentRole.canAdvancePathway)
                    .prototypePrimaryAction()

                    Button("Nuovo referral") {
                        store.requestReferralOnSelectedPatient()
                    }
                    .prototypeSecondaryAction()

                    Button("Referto") {
                        store.simulateReportArrivalOnSelectedPatient()
                    }
                    .prototypeSecondaryAction()

                    Button("Errore agenda") {
                        store.injectInvalidBookingOnSelectedPatient()
                    }
                    .prototypeSecondaryAction()
                }

                InfoCard(title: "Situazione corrente", systemImage: "stethoscope") {
                    VStack(alignment: .leading, spacing: 10) {
                        if store.currentRole.canViewClinicalSummary {
                            Text(patient.confirmedCondition)
                                .font(.headline)
                            Text(patient.boardRecommendation)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Vista clinica limitata")
                                .font(.headline)
                            Text("Sono visibili solo stato del percorso, prenotazioni e storico operativo.")
                                .foregroundStyle(.secondary)
                        }
                        Text("MMG: \(patient.mmgName) • Referral source: \(patient.referringUnit)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                InfoCard(title: "Consulto rapido", systemImage: "brain") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(consultation.locationSummary)
                        Text(consultation.conditionSummary)
                            .foregroundStyle(.secondary)
                        Divider()
                        Text(consultation.narrative)
                            .font(.headline)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Prossimi passaggi")
                                .font(.subheadline.weight(.semibold))
                            ForEach(consultation.nextSteps, id: \.self) { step in
                                Label(step, systemImage: "arrow.right.circle")
                            }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Rischi / alert")
                                .font(.subheadline.weight(.semibold))
                            ForEach(consultation.riskFlags, id: \.self) { risk in
                                Label(risk, systemImage: "exclamationmark.circle")
                            }
                        }
                    }
                }

                InfoCard(title: "Percorso", systemImage: "list.bullet.rectangle") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(patient.steps) { step in
                            StepRow(step: step)
                        }
                    }
                }

                HStack(alignment: .top, spacing: 16) {
                    InfoCard(title: "Referral e prenotazioni", systemImage: "arrow.triangle.branch") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(patient.referrals) { referral in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(referral.fromService) -> \(referral.toService)")
                                        .font(.headline)
                                    Text(referral.note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    StatusBadge(text: referral.state.rawValue, tint: .blue)
                                }
                            }
                            Divider()
                            ForEach(patient.bookings) { booking in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(booking.label)
                                        Text("\(booking.location) • \(shortDateTime(booking.scheduledFor))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    StatusBadge(
                                        text: booking.status.rawValue,
                                        tint: booking.status == .invalid ? .red : booking.status == .pendingReview ? .orange : .green
                                    )
                                }
                            }
                        }
                    }

                    InfoCard(title: "Checklist", systemImage: "checklist") {
                        VStack(alignment: .leading, spacing: 12) {
                            ProgressView(
                                value: Double(patient.completedChecklistCount),
                                total: Double(max(patient.checklist.count, 1))
                            )
                            ForEach(patient.checklist) { item in
                                HStack {
                                    Image(systemName: item.isComplete ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(item.isComplete ? .green : .secondary)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.title)
                                        Text(item.owner)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                            }
                        }
                    }
                }

                InfoCard(title: "Quick links", systemImage: "book") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(patient.track.guidanceLinks) { link in
                            Link(destination: link.url) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(link.title)
                                        Text(link.subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.up.right.square")
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                InfoCard(title: "Timeline", systemImage: "clock.arrow.circlepath") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(patient.timeline) { event in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(event.title)
                                        .font(.headline)
                                    Spacer()
                                    Text(shortDateTime(event.timestamp))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(event.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                StatusBadge(text: event.lane, tint: .gray)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
    }
}

private struct PrototypeSettingsSheet: View {
    @EnvironmentObject private var store: OncologyPrototypeStore
    @Binding var isPresented: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Impostazioni prototipo")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Chiudi") {
                    isPresented = false
                }
            }
            .padding(20)

            Divider()

            PrototypeSettingsView()
                .environmentObject(store)
        }
        .frame(width: 520, height: 520)
    }
}

struct PrototypeSettingsView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore

    var body: some View {
        Form {
            Section("Clinical intelligence") {
                Picker("Modalita", selection: $store.settings.intelligenceMode) {
                    ForEach(IntelligenceMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }

                Toggle("Alert proattivi su referti", isOn: $store.settings.proactiveAlerts)
                Toggle("Auto-promozione del report nello step successivo", isOn: $store.settings.autoPromoteReports)
            }

            Section("Guardrail di percorso") {
                Toggle("Blocca prestazioni incongrue", isOn: $store.settings.strictPathwayValidation)
                Toggle("Integra agenda e diario clinico", isOn: $store.settings.agendaIntegration)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Pressione errori di agenda: \(Int(store.settings.wrongBookingPressure * 100))%")
                    Slider(value: $store.settings.wrongBookingPressure, in: 0...1)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Congestione operativa: \(Int(store.settings.operationalCongestion * 100))%")
                    Slider(value: $store.settings.operationalCongestion, in: 0...1)
                }
            }

            Section("Demo") {
                Button("Reset dati sintetici") {
                    store.resetDemo()
                }
                Button("Riapri onboarding") {
                    store.reopenOnboarding()
                }
            }
        }
        .formStyle(.grouped)
        .padding(16)
    }
}

private struct PrototypeOnboardingView: View {
    @EnvironmentObject private var store: OncologyPrototypeStore

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Oncology Backbone Prototype")
                .font(.largeTitle.weight(.semibold))

            Text("Shell macOS sintetica per simulare il percorso oncologico: referral, workup, agenda, board, protocollo e inbox proattiva.")
                .foregroundStyle(.secondary)

            InfoCard(title: "Cosa trovi", systemImage: "wand.and.stars") {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Tre percorsi demo: HCC, NSCLC e SCLC", systemImage: "checkmark.circle")
                    Label("Tre ruoli applicativi con visibilita differenziata", systemImage: "checkmark.circle")
                    Label("Simulazione di errori di agenda, referti e avanzamento step", systemImage: "checkmark.circle")
                    Label("Dashboard, inbox e scheda paziente con consulto sintetico", systemImage: "checkmark.circle")
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Persona iniziale")
                    .font(.headline)
                Picker("Persona iniziale", selection: $store.currentRole) {
                    ForEach(PrototypeRole.allCases) { role in
                        Text(role.title).tag(role)
                    }
                }
                .pickerStyle(.segmented)
            }

            HStack {
                Spacer()
                Button("Apri il prototipo") {
                    store.completeOnboarding()
                }
                .prototypePrimaryAction()
            }
        }
        .padding(28)
        .frame(width: 760, height: 520)
    }
}

private struct NewPatientSheet: View {
    @Binding var draft: NewPatientDraft
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Nuovo caso oncologico")
                    .font(.title2.weight(.semibold))
                Spacer()
            }
            .padding(20)

            Divider()

            Form {
                TextField("Nome e cognome", text: $draft.fullName)
                TextField("Eta", text: $draft.age)
                TextField("MMG", text: $draft.mmgName)
                TextField("Unit di invio", text: $draft.referringUnit)

                Picker("Percorso", selection: $draft.track) {
                    ForEach(OncologyTrack.allCases) { track in
                        Text(track.title).tag(track)
                    }
                }

                TextField("Sospetto clinico", text: $draft.suspectedCondition)
                TextField("Condizione attuale", text: $draft.confirmedCondition)
            }
            .formStyle(.grouped)
            .padding(16)

            Divider()

            HStack {
                Button("Annulla") {
                    onCancel()
                }
                Spacer()
                Button("Inserisci nel percorso") {
                    onSubmit()
                }
                .prototypePrimaryAction()
            }
            .padding(20)
        }
        .frame(width: 560, height: 520)
    }
}

private struct MetricCard: View {
    let metric: DashboardMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(metric.title)
                .font(.headline)
            Text(metric.value)
                .font(.system(size: 34, weight: .bold))
            Text(metric.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .prototypeHero(tint: .white.opacity(0.06), cornerRadius: 22, padding: 18)
    }
}

private struct InfoCard<Content: View>: View {
    let title: String
    let systemImage: String
    let content: Content

    init(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .prototypePanel(cornerRadius: 22, padding: 18)
    }
}

private struct StepRow: View {
    let step: PathwayStep

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName)
                .foregroundStyle(iconTint)
                .font(.title3)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(step.title)
                        .font(.headline)
                    Spacer()
                    Text(shortDate(step.dueDate))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(step.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(step.owner)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var iconName: String {
        switch step.status {
        case .completed:
            return "checkmark.circle.fill"
        case .current:
            return "circle.inset.filled"
        case .upcoming:
            return "circle"
        case .attention:
            return "exclamationmark.circle.fill"
        case .blocked:
            return "slash.circle.fill"
        }
    }

    private var iconTint: Color {
        switch step.status {
        case .completed:
            return .green
        case .current:
            return .blue
        case .upcoming:
            return .secondary
        case .attention:
            return .orange
        case .blocked:
            return .red
        }
    }
}

private struct StatusBadge: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.opacity(0.14), in: Capsule())
            .foregroundStyle(tint)
    }
}

private struct PlaceholderDetailView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 34))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private func trackTint(_ track: OncologyTrack) -> Color {
    switch track {
    case .hcc:
        return .orange
    case .nsclc:
        return .teal
    case .sclc:
        return .pink
    }
}

private func severityTint(_ severity: AlertSeverity) -> Color {
    switch severity {
    case .info:
        return .blue
    case .watch:
        return .orange
    case .critical:
        return .red
    }
}

private func shortDate(_ date: Date?) -> String {
    guard let date else { return "—" }
    return date.formatted(date: .abbreviated, time: .omitted)
}

private func shortDateTime(_ date: Date) -> String {
    date.formatted(date: .abbreviated, time: .shortened)
}
