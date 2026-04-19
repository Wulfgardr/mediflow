import Foundation

enum PrototypeRole: String, CaseIterable, Codable, Identifiable {
    case oncologist
    case generalPractitioner
    case adminOperator

    var id: String { rawValue }

    var title: String {
        switch self {
        case .oncologist:
            return "Oncologo"
        case .generalPractitioner:
            return "MMG"
        case .adminOperator:
            return "Operatore amministrativo"
        }
    }

    var subtitle: String {
        switch self {
        case .oncologist:
            return "Vista clinica completa, consulto e avanzamento percorso"
        case .generalPractitioner:
            return "Follow-up referral, protocollo e stato del paziente"
        case .adminOperator:
            return "Focus su agenda, prenotazioni e colli di bottiglia"
        }
    }

    var canViewClinicalDetail: Bool {
        self == .oncologist
    }

    var canViewClinicalSummary: Bool {
        self != .adminOperator
    }

    var canAdvancePathway: Bool {
        self == .oncologist
    }

    var canManageBookings: Bool {
        self == .oncologist || self == .adminOperator
    }
}

enum PrototypeArea: String, CaseIterable, Codable, Identifiable {
    case dashboard
    case patients
    case inbox
    case operations

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard:
            return "Dashboard"
        case .patients:
            return "Pazienti"
        case .inbox:
            return "Inbox clinica"
        case .operations:
            return "Operations"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard:
            return "square.grid.2x2"
        case .patients:
            return "person.3"
        case .inbox:
            return "bell.badge"
        case .operations:
            return "waveform.path.ecg.rectangle"
        }
    }
}

enum IntelligenceMode: String, CaseIterable, Codable, Identifiable {
    case rules
    case copilot

    var id: String { rawValue }

    var title: String {
        switch self {
        case .rules:
            return "Heuristic"
        case .copilot:
            return "Copilot"
        }
    }
}

struct PrototypeSettings: Codable, Equatable {
    var intelligenceMode: IntelligenceMode = .copilot
    var strictPathwayValidation = true
    var proactiveAlerts = true
    var agendaIntegration = true
    var autoPromoteReports = true
    var wrongBookingPressure = 0.25
    var operationalCongestion = 0.35
}

enum OncologyTrack: String, CaseIterable, Codable, Identifiable {
    case hcc
    case nsclc
    case sclc

    var id: String { rawValue }

    var shortTitle: String {
        switch self {
        case .hcc:
            return "HCC"
        case .nsclc:
            return "NSCLC"
        case .sclc:
            return "SCLC"
        }
    }

    var title: String {
        switch self {
        case .hcc:
            return "Carcinoma epatocellulare"
        case .nsclc:
            return "Non-small cell lung cancer"
        case .sclc:
            return "Small cell lung cancer"
        }
    }

    var pathwayName: String {
        switch self {
        case .hcc:
            return "Percorso epato-oncologico"
        case .nsclc:
            return "Percorso toracico molecolare"
        case .sclc:
            return "Percorso toracico accelerato"
        }
    }

    var leadSpecialty: String {
        switch self {
        case .hcc:
            return "Epatologia"
        case .nsclc, .sclc:
            return "Oncologia toracica"
        }
    }

    var guidanceLinks: [GuidanceLink] {
        switch self {
        case .hcc:
            return [
                GuidanceLink(
                    title: "AIOM linee guida",
                    subtitle: "Portale linee guida oncologiche nazionali",
                    url: URL(string: "https://www.aiom.it/linee-guida-aiom/")!
                ),
                GuidanceLink(
                    title: "EASL HCC",
                    subtitle: "Clinical Practice Guidelines for HCC",
                    url: URL(string: "https://easl.eu/news/easl-cpgs-hcc/")!
                )
            ]
        case .nsclc, .sclc:
            return [
                GuidanceLink(
                    title: "AIOM linee guida",
                    subtitle: "Portale linee guida oncologiche nazionali",
                    url: URL(string: "https://www.aiom.it/linee-guida-aiom/")!
                ),
                GuidanceLink(
                    title: "ESMO Interactive Guidelines",
                    subtitle: "Repository ESMO per percorsi toracici",
                    url: URL(string: "https://interactiveguidelines.esmo.org/esmo-web-app/home/")!
                )
            ]
        }
    }

    var defaultChecklist: [String] {
        switch self {
        case .hcc:
            return [
                "Referto radiologico triphasico caricato",
                "Discussione epatologica validata",
                "Board multidisciplinare schedulato",
                "Funzionalita epatica aggiornata"
            ]
        case .nsclc:
            return [
                "Biopsia toracica refertata",
                "Profilo molecolare richiesto",
                "Staging PET/TC completato",
                "Board toracico convocato"
            ]
        case .sclc:
            return [
                "Broncoscopia con istologia completata",
                "Staging encefalo-torace programmato",
                "Accesso venoso valutato",
                "Piano terapia rapido condiviso"
            ]
        }
    }

    var therapyTemplate: TherapyProtocol? {
        switch self {
        case .hcc:
            return TherapyProtocol(
                name: "Atezolizumab + bevacizumab",
                intent: "Sistema / bridging",
                currentCycle: 1,
                totalCycles: 6,
                nextSession: nil
            )
        case .nsclc:
            return TherapyProtocol(
                name: "Chemo-immunoterapia platinum-based",
                intent: "Prima linea",
                currentCycle: 1,
                totalCycles: 4,
                nextSession: nil
            )
        case .sclc:
            return TherapyProtocol(
                name: "Platinum + etoposide",
                intent: "Trattamento accelerato",
                currentCycle: 1,
                totalCycles: 4,
                nextSession: nil
            )
        }
    }

    var stepTemplates: [PathwayStepTemplate] {
        switch self {
        case .hcc:
            return [
                PathwayStepTemplate(
                    title: "Inquadramento MMG",
                    owner: "MMG",
                    summary: "Sintomi, esami ematici e primo sospetto di lesione epatica.",
                    allowedBookings: [.ultrasound, .bloodPanel]
                ),
                PathwayStepTemplate(
                    title: "Imaging addome triphasico",
                    owner: "Radiologia",
                    summary: "TC/MR per caratterizzazione della lesione.",
                    allowedBookings: [.ctTriphasic, .liverMRI]
                ),
                PathwayStepTemplate(
                    title: "Referral epatologia",
                    owner: "Epatologia",
                    summary: "Valutazione funzionale, Child-Pugh e candidabilita.",
                    allowedBookings: [.hepatologyVisit]
                ),
                PathwayStepTemplate(
                    title: "Board fegato",
                    owner: "MDT fegato",
                    summary: "Decisione multidisciplinare su diagnostica e trattamento.",
                    allowedBookings: [.mdtBoard]
                ),
                PathwayStepTemplate(
                    title: "Oncologia e piano terapeutico",
                    owner: "Oncologia",
                    summary: "Definizione del piano sistemico o loco-regionale.",
                    allowedBookings: [.oncologyVisit]
                ),
                PathwayStepTemplate(
                    title: "Protocollo attivo",
                    owner: "Day hospital",
                    summary: "Avvio del protocollo e integrazione agenda/referti.",
                    allowedBookings: [.chemoInfusion, .followUpVisit]
                )
            ]
        case .nsclc:
            return [
                PathwayStepTemplate(
                    title: "Triage MMG e imaging torace",
                    owner: "MMG",
                    summary: "Sintomi respiratori, Rx/TC e sospetto toracico.",
                    allowedBookings: [.thoracicCT, .bloodPanel]
                ),
                PathwayStepTemplate(
                    title: "Referral pneumologia",
                    owner: "Pneumologia",
                    summary: "Valutazione bronchoscopica e accesso rapido.",
                    allowedBookings: [.pneumologyVisit, .bronchoscopy]
                ),
                PathwayStepTemplate(
                    title: "Istologia e biologia molecolare",
                    owner: "Anatomia patologica",
                    summary: "PD-L1, EGFR/ALK/ROS1 e markers principali.",
                    allowedBookings: [.biopsy, .molecularProfiling]
                ),
                PathwayStepTemplate(
                    title: "Staging PET/TC",
                    owner: "Medicina nucleare",
                    summary: "Completa la stadiazione e orienta il board.",
                    allowedBookings: [.petCT, .brainMRI]
                ),
                PathwayStepTemplate(
                    title: "Board toracico",
                    owner: "MDT torace",
                    summary: "Condivisione della strategia terapeutica.",
                    allowedBookings: [.mdtBoard]
                ),
                PathwayStepTemplate(
                    title: "Protocollo sistemico",
                    owner: "Oncologia toracica",
                    summary: "Avvio del protocollo e agenda infusioni.",
                    allowedBookings: [.oncologyVisit, .chemoInfusion]
                )
            ]
        case .sclc:
            return [
                PathwayStepTemplate(
                    title: "Accesso rapido MMG",
                    owner: "MMG",
                    summary: "Triage rapido per quadro toracico sospetto.",
                    allowedBookings: [.thoracicCT, .bloodPanel]
                ),
                PathwayStepTemplate(
                    title: "Pneumologia e broncoscopia",
                    owner: "Pneumologia",
                    summary: "Conferma istologica rapida.",
                    allowedBookings: [.pneumologyVisit, .bronchoscopy]
                ),
                PathwayStepTemplate(
                    title: "Staging accelerato",
                    owner: "Radiologia",
                    summary: "TC, RM encefalo e priorita alta in agenda.",
                    allowedBookings: [.petCT, .brainMRI]
                ),
                PathwayStepTemplate(
                    title: "Board toracico urgente",
                    owner: "MDT torace",
                    summary: "Decisione rapida su schema terapeutico.",
                    allowedBookings: [.mdtBoard]
                ),
                PathwayStepTemplate(
                    title: "Chemioterapia avviata",
                    owner: "Day hospital",
                    summary: "Avvio protocollo e follow-up tossicita.",
                    allowedBookings: [.oncologyVisit, .chemoInfusion]
                )
            ]
        }
    }
}

struct PathwayStepTemplate: Codable, Hashable {
    let title: String
    let owner: String
    let summary: String
    let allowedBookings: [BookingKind]
}

enum PathwayStepStatus: String, Codable {
    case completed
    case current
    case upcoming
    case attention
    case blocked
}

struct PathwayStep: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let owner: String
    let summary: String
    let dueDate: Date
    let allowedBookings: [BookingKind]
    var status: PathwayStepStatus
}

enum BookingKind: String, CaseIterable, Codable, Identifiable {
    case ultrasound
    case bloodPanel
    case ctTriphasic
    case liverMRI
    case thoracicCT
    case bronchoscopy
    case biopsy
    case pneumologyVisit
    case hepatologyVisit
    case oncologyVisit
    case molecularProfiling
    case petCT
    case brainMRI
    case mdtBoard
    case chemoInfusion
    case followUpVisit

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ultrasound:
            return "Ecografia addome"
        case .bloodPanel:
            return "Pannello ematico"
        case .ctTriphasic:
            return "TC triphasica"
        case .liverMRI:
            return "RM fegato"
        case .thoracicCT:
            return "TC torace"
        case .bronchoscopy:
            return "Broncoscopia"
        case .biopsy:
            return "Biopsia"
        case .pneumologyVisit:
            return "Visita pneumologica"
        case .hepatologyVisit:
            return "Visita epatologica"
        case .oncologyVisit:
            return "Visita oncologica"
        case .molecularProfiling:
            return "Profilo molecolare"
        case .petCT:
            return "PET/TC"
        case .brainMRI:
            return "RM encefalo"
        case .mdtBoard:
            return "Board multidisciplinare"
        case .chemoInfusion:
            return "Seduta di protocollo"
        case .followUpVisit:
            return "Follow-up"
        }
    }
}

enum BookingStatus: String, Codable {
    case scheduled
    case completed
    case pendingReview
    case invalid
}

struct BookingItem: Identifiable, Codable, Hashable {
    let id: String
    let kind: BookingKind
    let label: String
    let scheduledFor: Date
    let location: String
    let owner: String
    var status: BookingStatus
}

enum ReferralState: String, Codable {
    case requested
    case accepted
    case completed
}

struct ReferralRecord: Identifiable, Codable, Hashable {
    let id: String
    let fromService: String
    let toService: String
    let requestedAt: Date
    let note: String
    var state: ReferralState
}

enum AlertSeverity: String, Codable, Comparable {
    case info
    case watch
    case critical

    static func < (lhs: AlertSeverity, rhs: AlertSeverity) -> Bool {
        lhs.priorityValue < rhs.priorityValue
    }

    var priorityValue: Int {
        switch self {
        case .info:
            return 0
        case .watch:
            return 1
        case .critical:
            return 2
        }
    }
}

enum AlertKind: String, Codable {
    case reportReady
    case invalidBooking
    case referralDelay
    case boardDue
    case protocolDrift
}

struct ClinicalAlert: Identifiable, Codable, Hashable {
    let id: String
    let patientID: String
    let kind: AlertKind
    let title: String
    let detail: String
    let createdAt: Date
    let owner: String
    var severity: AlertSeverity
    var isResolved: Bool
}

struct ChecklistItem: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let owner: String
    var isComplete: Bool
}

struct TimelineEvent: Identifiable, Codable, Hashable {
    let id: String
    let timestamp: Date
    let lane: String
    let title: String
    let detail: String
}

struct TherapyProtocol: Identifiable, Codable, Hashable {
    var id: String { name }

    let name: String
    let intent: String
    var currentCycle: Int
    let totalCycles: Int
    var nextSession: Date?
}

struct GuidanceLink: Identifiable, Codable, Hashable {
    var id: String { title + subtitle }

    let title: String
    let subtitle: String
    let url: URL
}

struct PatientCase: Identifiable, Codable, Hashable {
    let id: String
    var fullName: String
    var age: Int
    var mmgName: String
    var referringUnit: String
    var track: OncologyTrack
    var suspectedCondition: String
    var confirmedCondition: String
    var currentLocation: String
    var boardRecommendation: String
    var lastReportSummary: String
    var therapyProtocol: TherapyProtocol?
    var steps: [PathwayStep]
    var referrals: [ReferralRecord]
    var bookings: [BookingItem]
    var checklist: [ChecklistItem]
    var alerts: [ClinicalAlert]
    var timeline: [TimelineEvent]
    var updatedAt: Date

    var currentStep: PathwayStep? {
        steps.first(where: { $0.status == .current || $0.status == .attention || $0.status == .blocked })
    }

    var unresolvedAlerts: [ClinicalAlert] {
        alerts.filter { !$0.isResolved }
            .sorted { lhs, rhs in
                if lhs.severity != rhs.severity {
                    return lhs.severity > rhs.severity
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    var nextDueDate: Date? {
        currentStep?.dueDate ?? steps.first(where: { $0.status == .upcoming })?.dueDate
    }

    var completedChecklistCount: Int {
        checklist.filter(\.isComplete).count
    }

    var activeBookingIssues: [BookingItem] {
        bookings.filter { $0.status == .invalid || $0.status == .pendingReview }
    }
}

struct PrototypeUser: Identifiable, Hashable {
    let id: String
    let name: String
    let role: PrototypeRole
    let focus: String
    let openItems: Int
    let availability: String
}

struct ConsultationBrief: Hashable {
    let locationSummary: String
    let conditionSummary: String
    let nextSteps: [String]
    let riskFlags: [String]
    let narrative: String
}

struct DashboardMetric: Identifiable, Hashable {
    let id: String
    let title: String
    let value: String
    let detail: String
}

struct ChartBucket: Identifiable, Hashable {
    let id: String
    let label: String
    let count: Int
}

extension PatientCase {
    static func make(
        id: String = UUID().uuidString,
        fullName: String,
        age: Int,
        mmgName: String,
        referringUnit: String,
        track: OncologyTrack,
        suspectedCondition: String,
        confirmedCondition: String,
        currentStepIndex: Int,
        stepsRequiringAttention: Set<Int> = [],
        completedChecklist: Set<Int> = [],
        therapyProtocol: TherapyProtocol? = nil,
        currentLocation: String? = nil,
        boardRecommendation: String,
        lastReportSummary: String,
        baseDate: Date
    ) -> PatientCase {
        let steps = track.stepTemplates.enumerated().map { offset, template in
            PathwayStep(
                id: "\(track.rawValue)-step-\(offset)",
                title: template.title,
                owner: template.owner,
                summary: template.summary,
                dueDate: Calendar.current.date(byAdding: .day, value: offset * 3, to: baseDate) ?? baseDate,
                allowedBookings: template.allowedBookings,
                status: statusForStep(
                    offset: offset,
                    currentStepIndex: currentStepIndex,
                    requiresAttention: stepsRequiringAttention.contains(offset)
                )
            )
        }

        let checklist = track.defaultChecklist.enumerated().map { offset, item in
            ChecklistItem(
                id: "\(track.rawValue)-check-\(offset)",
                title: item,
                owner: offset < 2 ? "Clinico" : "Operations",
                isComplete: completedChecklist.contains(offset)
            )
        }

        return PatientCase(
            id: id,
            fullName: fullName,
            age: age,
            mmgName: mmgName,
            referringUnit: referringUnit,
            track: track,
            suspectedCondition: suspectedCondition,
            confirmedCondition: confirmedCondition,
            currentLocation: currentLocation ?? steps[currentStepIndex].owner,
            boardRecommendation: boardRecommendation,
            lastReportSummary: lastReportSummary,
            therapyProtocol: therapyProtocol,
            steps: steps,
            referrals: [],
            bookings: [],
            checklist: checklist,
            alerts: [],
            timeline: [],
            updatedAt: baseDate
        )
    }

    private static func statusForStep(
        offset: Int,
        currentStepIndex: Int,
        requiresAttention: Bool
    ) -> PathwayStepStatus {
        if offset < currentStepIndex {
            return .completed
        }
        if offset == currentStepIndex {
            return requiresAttention ? .attention : .current
        }
        return .upcoming
    }
}
