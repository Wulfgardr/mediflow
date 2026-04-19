import Foundation

struct NewPatientDraft {
    var fullName = ""
    var age = "64"
    var mmgName = "Dr.ssa Bianchi"
    var referringUnit = "MMG territoriale"
    var track: OncologyTrack = .hcc
    var suspectedCondition = "Lesione sospetta in iter diagnostico"
    var confirmedCondition = "Caso in attesa di conferma specialistica"
}

final class OncologyPrototypeStore: ObservableObject {
    private enum Keys {
        static let role = "oncology.prototype.role"
        static let settings = "oncology.prototype.settings"
        static let completedOnboarding = "oncology.prototype.onboarding.completed"
    }

    @Published var currentRole: PrototypeRole {
        didSet {
            userDefaults.set(currentRole.rawValue, forKey: Keys.role)
        }
    }

    @Published var selectedArea: PrototypeArea = .dashboard
    @Published var selectedPatientID: PatientCase.ID?
    @Published var selectedAlertID: ClinicalAlert.ID?
    @Published var settings: PrototypeSettings {
        didSet {
            if let encoded = try? JSONEncoder().encode(settings) {
                userDefaults.set(encoded, forKey: Keys.settings)
            }
        }
    }
    @Published var patients: [PatientCase]
    @Published var showOnboarding: Bool

    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        if let storedRole = userDefaults.string(forKey: Keys.role),
           let role = PrototypeRole(rawValue: storedRole) {
            currentRole = role
        } else {
            currentRole = .oncologist
        }

        if let encodedSettings = userDefaults.data(forKey: Keys.settings),
           let decodedSettings = try? JSONDecoder().decode(PrototypeSettings.self, from: encodedSettings) {
            settings = decodedSettings
        } else {
            settings = PrototypeSettings()
        }

        let now = Date()
        patients = Self.makeSeedPatients(now: now)
        showOnboarding = !userDefaults.bool(forKey: Keys.completedOnboarding)
        selectedPatientID = patients.first?.id
    }

    var selectedPatient: PatientCase? {
        guard let selectedPatientID else { return nil }
        return patients.first(where: { $0.id == selectedPatientID })
    }

    var pendingAlerts: [ClinicalAlert] {
        patients
            .flatMap(\.unresolvedAlerts)
            .sorted { lhs, rhs in
                if lhs.severity != rhs.severity {
                    return lhs.severity > rhs.severity
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    var selectedAlert: ClinicalAlert? {
        guard let selectedAlertID else { return nil }
        return pendingAlerts.first(where: { $0.id == selectedAlertID })
    }

    var operationsUsers: [PrototypeUser] {
        [
            PrototypeUser(
                id: "u-onco",
                name: "Dr. Giulia Rinaldi",
                role: .oncologist,
                focus: "Board e piano sistemico",
                openItems: pendingAlerts.filter { $0.owner == "Oncologia" }.count,
                availability: settings.operationalCongestion > 0.7 ? "Agenda piena" : "Disponibile"
            ),
            PrototypeUser(
                id: "u-mmg",
                name: "Dr. Marco Bellini",
                role: .generalPractitioner,
                focus: "Monitoraggio territoriale",
                openItems: patients.filter { $0.currentStep?.owner == "MMG" }.count,
                availability: "Follow-up attivo"
            ),
            PrototypeUser(
                id: "u-admin",
                name: "Sara Conti",
                role: .adminOperator,
                focus: "Agenda e prenotazioni",
                openItems: allBookings.filter { $0.status == .invalid || $0.status == .pendingReview }.count,
                availability: settings.operationalCongestion > 0.6 ? "Da rinforzare" : "Controllata"
            )
        ]
    }

    var allBookings: [BookingItem] {
        patients
            .flatMap(\.bookings)
            .sorted { $0.scheduledFor < $1.scheduledFor }
    }

    var dashboardMetrics: [DashboardMetric] {
        let unresolved = pendingAlerts.count
        let invalidBookings = allBookings.filter { $0.status == .invalid || $0.status == .pendingReview }.count
        let protocols = patients.filter { $0.therapyProtocol != nil }.count
        let pendingReferrals = patients.flatMap(\.referrals).filter { $0.state != .completed }.count

        switch currentRole {
        case .oncologist:
            return [
                DashboardMetric(id: "m1", title: "Casi in carico", value: "\(patients.count)", detail: "Percorsi sintetici monitorati"),
                DashboardMetric(id: "m2", title: "Alert aperti", value: "\(unresolved)", detail: "Promemoria proattivi da chiudere"),
                DashboardMetric(id: "m3", title: "Protocolli attivi", value: "\(protocols)", detail: "Pazienti con trattamento gia avviato"),
                DashboardMetric(id: "m4", title: "Agenda critica", value: "\(invalidBookings)", detail: "Prestazioni non congrue o da revisionare")
            ]
        case .generalPractitioner:
            return [
                DashboardMetric(id: "m1", title: "Pazienti inviati", value: "\(patients.count)", detail: "Referral tracciati dal territorio"),
                DashboardMetric(id: "m2", title: "Referral pendenti", value: "\(pendingReferrals)", detail: "In attesa di presa in carico"),
                DashboardMetric(id: "m3", title: "Follow-up attivi", value: "\(protocols)", detail: "Pazienti in protocollo condiviso"),
                DashboardMetric(id: "m4", title: "Alert condivisi", value: "\(unresolved)", detail: "Segnalazioni da monitorare con lo specialista")
            ]
        case .adminOperator:
            return [
                DashboardMetric(id: "m1", title: "Slot osservati", value: "\(allBookings.count)", detail: "Prestazioni tracciate dall'agenda"),
                DashboardMetric(id: "m2", title: "Prestazioni da sanare", value: "\(invalidBookings)", detail: "Prenotazioni incongrue o incomplete"),
                DashboardMetric(id: "m3", title: "Punti di coda", value: "\(pendingAlerts.filter { $0.severity == .critical }.count)", detail: "Segnalazioni con impatto operativo"),
                DashboardMetric(id: "m4", title: "Team coinvolto", value: "\(operationsUsers.count)", detail: "Ruoli demo monitorati nel prototipo")
            ]
        }
    }

    var chartBuckets: [ChartBucket] {
        let groups = Dictionary(grouping: patients, by: OncologyPathwayEngine.stageBucket)
        let order = ["Intake", "Workup", "Board", "Protocollo", "In follow-up"]
        return order.map { label in
            ChartBucket(id: label, label: label, count: groups[label]?.count ?? 0)
        }
    }

    var upcomingBookings: [BookingItem] {
        allBookings
            .filter { $0.status != .completed }
            .prefix(6)
            .map { $0 }
    }

    var boardPriorityPatients: [PatientCase] {
        patients
            .filter { OncologyPathwayEngine.stageBucket(for: $0) == "Board" || $0.unresolvedAlerts.contains(where: { $0.kind == .boardDue }) }
            .sorted { lhs, rhs in
                let lhsAlert = lhs.unresolvedAlerts.first?.severity.priorityValue ?? -1
                let rhsAlert = rhs.unresolvedAlerts.first?.severity.priorityValue ?? -1
                if lhsAlert != rhsAlert {
                    return lhsAlert > rhsAlert
                }
                return lhs.updatedAt > rhs.updatedAt
            }
    }

    var territorialPatients: [PatientCase] {
        patients
            .sorted { lhs, rhs in
                let lhsDate = lhs.nextDueDate ?? .distantFuture
                let rhsDate = rhs.nextDueDate ?? .distantFuture
                if lhsDate != rhsDate {
                    return lhsDate < rhsDate
                }
                return lhs.fullName < rhs.fullName
            }
    }

    var protocolPatients: [PatientCase] {
        patients
            .filter { $0.therapyProtocol != nil }
            .sorted { lhs, rhs in
                let lhsCycle = lhs.therapyProtocol?.currentCycle ?? 0
                let rhsCycle = rhs.therapyProtocol?.currentCycle ?? 0
                if lhsCycle != rhsCycle {
                    return lhsCycle > rhsCycle
                }
                return lhs.updatedAt > rhs.updatedAt
            }
    }

    var rolePulseTitle: String {
        switch currentRole {
        case .oncologist:
            return "Rendere fluido il passaggio board -> protocollo"
        case .generalPractitioner:
            return "Seguire referral e milestone del territorio"
        case .adminOperator:
            return "Pulire la coda agenda e prevenire drift operativo"
        }
    }

    var rolePulseSummary: String {
        switch currentRole {
        case .oncologist:
            return "La shell privilegia board due, consulto rapido, therapy readiness e proattivita sui referti."
        case .generalPractitioner:
            return "La dashboard mette in primo piano presa in carico, prossimi appuntamenti e progressione del protocollo."
        case .adminOperator:
            return "La vista operations mostra slot critici, booking incongrui e disponibilita del team."
        }
    }

    func completeOnboarding() {
        userDefaults.set(true, forKey: Keys.completedOnboarding)
        showOnboarding = false
    }

    func reopenOnboarding() {
        showOnboarding = true
    }

    func resetDemo() {
        let now = Date()
        patients = Self.makeSeedPatients(now: now)
        selectedArea = .dashboard
        selectedAlertID = nil
        selectedPatientID = patients.first?.id
    }

    func filteredPatients(query: String, track: OncologyTrack?) -> [PatientCase] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let terms = trimmed.split(whereSeparator: { $0.isWhitespace }).map(String.init)

        let trackFiltered = patients.filter { patient in
            guard let track else { return true }
            return patient.track == track
        }

        return trackFiltered
            .filter { patient in
                guard !terms.isEmpty else { return true }
                let haystack = "\(patient.fullName) \(patient.confirmedCondition) \(patient.track.shortTitle) \(patient.currentLocation)".lowercased()
                return terms.allSatisfy { haystack.contains($0) }
            }
            .sorted { lhs, rhs in
                let lhsPriority = lhs.unresolvedAlerts.first?.severity.priorityValue ?? -1
                let rhsPriority = rhs.unresolvedAlerts.first?.severity.priorityValue ?? -1
                if lhsPriority != rhsPriority {
                    return lhsPriority > rhsPriority
                }
                return lhs.updatedAt > rhs.updatedAt
            }
    }

    func selectPatient(_ patientID: PatientCase.ID?) {
        selectedPatientID = patientID
        if patientID != nil {
            selectedAlertID = nil
        }
    }

    func selectAlert(_ alertID: ClinicalAlert.ID?) {
        selectedAlertID = alertID
        guard let alertID,
              let alert = pendingAlerts.first(where: { $0.id == alertID }) else {
            return
        }
        selectedPatientID = alert.patientID
    }

    func addPatient(from draft: NewPatientDraft) {
        let now = Date()
        let patient = PatientCase.make(
            fullName: draft.fullName.isEmpty ? "Nuovo caso demo" : draft.fullName,
            age: Int(draft.age) ?? 64,
            mmgName: draft.mmgName,
            referringUnit: draft.referringUnit,
            track: draft.track,
            suspectedCondition: draft.suspectedCondition,
            confirmedCondition: draft.confirmedCondition,
            currentStepIndex: 0,
            boardRecommendation: "Caso appena inserito; attendere completamento workup.",
            lastReportSummary: "Nessun referto specialistico ancora disponibile.",
            baseDate: now
        )

        var seeded = OncologyPathwayEngine.requestReferral(
            for: patient,
            from: draft.referringUnit,
            to: draft.track.leadSpecialty,
            note: "Nuovo ingresso nel percorso \(draft.track.shortTitle).",
            now: now
        )
        seeded.alerts.insert(
            ClinicalAlert(
                id: UUID().uuidString,
                patientID: seeded.id,
                kind: .referralDelay,
                title: "Nuovo caso in intake",
                detail: "Monitorare presa in carico entro 48h e programmare il primo slot.",
                createdAt: now,
                owner: "Operations",
                severity: .info,
                isResolved: false
            ),
            at: 0
        )

        patients.insert(seeded, at: 0)
        selectedArea = .patients
        selectedPatientID = seeded.id
        selectedAlertID = nil
    }

    func advanceSelectedPatient() {
        guard let selectedPatientID else { return }
        updatePatient(id: selectedPatientID) { patient in
            OncologyPathwayEngine.advance(
                patient: patient,
                actorRole: currentRole,
                settings: settings
            )
        }
    }

    func injectInvalidBookingOnSelectedPatient() {
        guard let selectedPatientID else { return }
        updatePatient(id: selectedPatientID) { patient in
            OncologyPathwayEngine.injectInvalidBooking(into: patient, settings: settings)
        }
        selectedArea = .inbox
    }

    func simulateReportArrivalOnSelectedPatient() {
        guard let selectedPatientID else { return }
        updatePatient(id: selectedPatientID) { patient in
            OncologyPathwayEngine.simulateReportArrival(for: patient, settings: settings)
        }
        selectedArea = .inbox
    }

    func requestReferralOnSelectedPatient() {
        guard let selectedPatientID else { return }
        updatePatient(id: selectedPatientID) { patient in
            OncologyPathwayEngine.requestReferral(
                for: patient,
                from: currentRole.title,
                to: patient.track.leadSpecialty,
                note: "Referral aggiuntivo generato dal prototipo.",
                now: Date()
            )
        }
    }

    func resolveSelectedAlert() {
        guard let selectedAlertID,
              let alert = selectedAlert else { return }

        updatePatient(id: alert.patientID) { patient in
            OncologyPathwayEngine.resolveAlert(in: patient, alertID: selectedAlertID)
        }
        self.selectedAlertID = nil
    }

    func simulateOperationalDay() {
        guard !patients.isEmpty else { return }

        if settings.proactiveAlerts,
           let firstNoReportIndex = patients.firstIndex(where: {
               !$0.unresolvedAlerts.contains(where: { $0.kind == .reportReady })
           }) {
            patients[firstNoReportIndex] = OncologyPathwayEngine.simulateReportArrival(
                for: patients[firstNoReportIndex],
                settings: settings
            )
        }

        if settings.wrongBookingPressure > 0.5,
           let firstWithoutIssueIndex = patients.firstIndex(where: { $0.activeBookingIssues.isEmpty }) {
            patients[firstWithoutIssueIndex] = OncologyPathwayEngine.injectInvalidBooking(
                into: patients[firstWithoutIssueIndex],
                settings: settings
            )
        }

        if settings.operationalCongestion < 0.5,
           let firstActionableIndex = patients.firstIndex(where: {
               $0.activeBookingIssues.isEmpty && $0.currentStep?.status == .current
           }) {
            patients[firstActionableIndex] = OncologyPathwayEngine.advance(
                patient: patients[firstActionableIndex],
                actorRole: .oncologist,
                settings: settings
            )
        }
    }

    func consultation(for patient: PatientCase) -> ConsultationBrief {
        OncologyPathwayEngine.consultation(
            for: patient,
            role: currentRole,
            settings: settings
        )
    }

    private func updatePatient(id: PatientCase.ID, mutate: (PatientCase) -> PatientCase) {
        guard let index = patients.firstIndex(where: { $0.id == id }) else {
            return
        }
        let updated = mutate(patients[index])
        patients[index] = updated
        selectedPatientID = updated.id
    }

    private static func makeSeedPatients(now: Date) -> [PatientCase] {
        var hcc = PatientCase.make(
            id: "patient-hcc",
            fullName: "Giovanni Leone",
            age: 67,
            mmgName: "Dr. Marco Bellini",
            referringUnit: "MMG Distretto Nord",
            track: .hcc,
            suspectedCondition: "Lesione epatica sospetta",
            confirmedCondition: "HCC in valutazione per strategia sistemica",
            currentStepIndex: 3,
            stepsRequiringAttention: [3],
            completedChecklist: [0, 1],
            therapyProtocol: nil,
            currentLocation: "MDT fegato",
            boardRecommendation: "Valutare candidatura a strategia sistemica con controllo stretto della funzione epatica.",
            lastReportSummary: "TC triphasica compatibile con lesione focale a wash-out; AFP in incremento.",
            baseDate: Calendar.current.date(byAdding: .day, value: -14, to: now) ?? now
        )
        hcc.referrals = [
            ReferralRecord(
                id: "ref-hcc-1",
                fromService: "MMG Distretto Nord",
                toService: "Epatologia",
                requestedAt: Calendar.current.date(byAdding: .day, value: -12, to: now) ?? now,
                note: "Sospetta lesione epatica da completare.",
                state: .completed
            ),
            ReferralRecord(
                id: "ref-hcc-2",
                fromService: "Epatologia",
                toService: "MDT fegato",
                requestedAt: Calendar.current.date(byAdding: .day, value: -3, to: now) ?? now,
                note: "Richiesta discussione multidisciplinare.",
                state: .accepted
            )
        ]
        hcc.bookings = [
            BookingItem(
                id: "book-hcc-1",
                kind: .ctTriphasic,
                label: BookingKind.ctTriphasic.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: -9, to: now) ?? now,
                location: "Radiologia",
                owner: "CUP oncologico",
                status: .completed
            ),
            BookingItem(
                id: "book-hcc-2",
                kind: .mdtBoard,
                label: BookingKind.mdtBoard.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: 2, to: now) ?? now,
                location: "MDT fegato",
                owner: "Operations",
                status: .scheduled
            )
        ]
        hcc.alerts = [
            ClinicalAlert(
                id: "alert-hcc-1",
                patientID: hcc.id,
                kind: .boardDue,
                title: "Board fegato in scadenza",
                detail: "Il caso deve essere chiuso nel board entro 48h per evitare slittamento del piano terapeutico.",
                createdAt: Calendar.current.date(byAdding: .hour, value: -8, to: now) ?? now,
                owner: "Oncologia",
                severity: .watch,
                isResolved: false
            )
        ]
        hcc.timeline = [
            TimelineEvent(
                id: "timeline-hcc-1",
                timestamp: Calendar.current.date(byAdding: .day, value: -9, to: now) ?? now,
                lane: "referti",
                title: "TC triphasica acquisita",
                detail: "Referto sincronizzato nella scheda paziente."
            ),
            TimelineEvent(
                id: "timeline-hcc-2",
                timestamp: Calendar.current.date(byAdding: .day, value: -3, to: now) ?? now,
                lane: "referral",
                title: "Invio a MDT fegato",
                detail: "Richiesta discussione multidisciplinare approvata."
            )
        ]
        hcc.updatedAt = now

        var nsclc = PatientCase.make(
            id: "patient-nsclc",
            fullName: "Elena Conti",
            age: 61,
            mmgName: "Dr.ssa Laura Bruni",
            referringUnit: "MMG Distretto Est",
            track: .nsclc,
            suspectedCondition: "Nodulo polmonare sospetto",
            confirmedCondition: "NSCLC con profilo molecolare in completamento",
            currentStepIndex: 5,
            completedChecklist: [0, 1, 2],
            therapyProtocol: TherapyProtocol(
                name: "Chemo-immunoterapia platinum-based",
                intent: "Prima linea",
                currentCycle: 2,
                totalCycles: 4,
                nextSession: Calendar.current.date(byAdding: .day, value: 6, to: now)
            ),
            currentLocation: "Oncologia toracica",
            boardRecommendation: "Avviare schema sistemico dopo validazione biomarcatori.",
            lastReportSummary: "Biopsia positiva per NSCLC; PD-L1 45%, profilo NGS atteso.",
            baseDate: Calendar.current.date(byAdding: .day, value: -20, to: now) ?? now
        )
        nsclc.referrals = [
            ReferralRecord(
                id: "ref-nsclc-1",
                fromService: "MMG Distretto Est",
                toService: "Pneumologia",
                requestedAt: Calendar.current.date(byAdding: .day, value: -18, to: now) ?? now,
                note: "Dispnea e imaging toracico sospetto.",
                state: .completed
            ),
            ReferralRecord(
                id: "ref-nsclc-2",
                fromService: "Pneumologia",
                toService: "Oncologia toracica",
                requestedAt: Calendar.current.date(byAdding: .day, value: -8, to: now) ?? now,
                note: "Caso pronto per definizione trattamento.",
                state: .completed
            )
        ]
        nsclc.bookings = [
            BookingItem(
                id: "book-nsclc-1",
                kind: .biopsy,
                label: BookingKind.biopsy.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: -15, to: now) ?? now,
                location: "Pneumologia interventistica",
                owner: "CUP oncologico",
                status: .completed
            ),
            BookingItem(
                id: "book-nsclc-2",
                kind: .chemoInfusion,
                label: BookingKind.chemoInfusion.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: 6, to: now) ?? now,
                location: "Day hospital",
                owner: "Operations",
                status: .scheduled
            )
        ]
        nsclc.alerts = [
            ClinicalAlert(
                id: "alert-nsclc-1",
                patientID: nsclc.id,
                kind: .reportReady,
                title: "Referto molecolare in arrivo",
                detail: "Tenere il caso in osservazione: il board potrebbe confermare target therapy.",
                createdAt: Calendar.current.date(byAdding: .hour, value: -5, to: now) ?? now,
                owner: "Oncologia",
                severity: .info,
                isResolved: false
            )
        ]
        nsclc.timeline = [
            TimelineEvent(
                id: "timeline-nsclc-1",
                timestamp: Calendar.current.date(byAdding: .day, value: -16, to: now) ?? now,
                lane: "diagnostica",
                title: "Broncoscopia completata",
                detail: "Materiale inviato a anatomia patologica."
            ),
            TimelineEvent(
                id: "timeline-nsclc-2",
                timestamp: Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now,
                lane: "protocollo",
                title: "Ciclo 2 pianificato",
                detail: "Agenda infusioni sincronizzata con follow-up."
            )
        ]
        nsclc.updatedAt = Calendar.current.date(byAdding: .hour, value: -3, to: now) ?? now

        var sclc = PatientCase.make(
            id: "patient-sclc",
            fullName: "Marco Serra",
            age: 58,
            mmgName: "Dr. Fabio Neri",
            referringUnit: "PS territoriale",
            track: .sclc,
            suspectedCondition: "Massa ilare ad alta priorita",
            confirmedCondition: "SCLC esteso con presa in carico accelerata",
            currentStepIndex: 2,
            stepsRequiringAttention: [2],
            completedChecklist: [0, 1],
            therapyProtocol: nil,
            currentLocation: "Radiologia",
            boardRecommendation: "Completare staging encefalo-torace e chiudere board urgente entro domani.",
            lastReportSummary: "Broncoscopia positiva per SCLC; necessita staging accelerato.",
            baseDate: Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now
        )
        sclc.bookings = [
            BookingItem(
                id: "book-sclc-1",
                kind: .petCT,
                label: BookingKind.petCT.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now,
                location: "Medicina nucleare",
                owner: "Operations",
                status: .scheduled
            ),
            BookingItem(
                id: "book-sclc-2",
                kind: .hepatologyVisit,
                label: BookingKind.hepatologyVisit.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: 4, to: now) ?? now,
                location: "Agenda condivisa",
                owner: "Operations",
                status: .invalid
            )
        ]
        sclc.alerts = [
            ClinicalAlert(
                id: "alert-sclc-1",
                patientID: sclc.id,
                kind: .invalidBooking,
                title: "Prestazione incongrua in agenda",
                detail: "La visita epatologica non e prevista nel percorso SCLC attuale.",
                createdAt: Calendar.current.date(byAdding: .hour, value: -2, to: now) ?? now,
                owner: "CUP oncologico",
                severity: .critical,
                isResolved: false
            )
        ]
        sclc.referrals = [
            ReferralRecord(
                id: "ref-sclc-1",
                fromService: "PS territoriale",
                toService: "Pneumologia",
                requestedAt: Calendar.current.date(byAdding: .day, value: -6, to: now) ?? now,
                note: "Presa in carico rapida per sospetto SCLC.",
                state: .completed
            )
        ]
        sclc.timeline = [
            TimelineEvent(
                id: "timeline-sclc-1",
                timestamp: Calendar.current.date(byAdding: .day, value: -5, to: now) ?? now,
                lane: "diagnostica",
                title: "Broncoscopia completata",
                detail: "Istologia positiva per small cell lung cancer."
            ),
            TimelineEvent(
                id: "timeline-sclc-2",
                timestamp: Calendar.current.date(byAdding: .hour, value: -2, to: now) ?? now,
                lane: "operations",
                title: "Errore di prenotazione intercettato",
                detail: "Il sistema ha bloccato una visita non congrua con il percorso."
            )
        ]
        sclc.updatedAt = Calendar.current.date(byAdding: .hour, value: -1, to: now) ?? now

        return [hcc, nsclc, sclc]
    }
}
