import Foundation

enum OncologyPathwayEngine {
    static func advance(
        patient originalPatient: PatientCase,
        actorRole: PrototypeRole,
        settings: PrototypeSettings,
        now: Date = Date()
    ) -> PatientCase {
        guard actorRole.canAdvancePathway else {
            return originalPatient
        }

        var patient = originalPatient
        guard let currentIndex = patient.steps.firstIndex(where: isActionableStatus) else {
            return patient
        }

        if settings.strictPathwayValidation, !patient.activeBookingIssues.isEmpty {
            patient.steps[currentIndex].status = .blocked
            if !patient.unresolvedAlerts.contains(where: { $0.kind == .invalidBooking }) {
                patient.alerts.append(
                    ClinicalAlert(
                        id: UUID().uuidString,
                        patientID: patient.id,
                        kind: .invalidBooking,
                        title: "Avanzamento bloccato",
                        detail: "Esiste almeno una prestazione non congrua rispetto allo step corrente.",
                        createdAt: now,
                        owner: "Operations",
                        severity: .critical,
                        isResolved: false
                    )
                )
            }
            patient.timeline.insert(
                TimelineEvent(
                    id: UUID().uuidString,
                    timestamp: now,
                    lane: "motore",
                    title: "Blocco percorso",
                    detail: "Lo step non puo avanzare finche non viene sanata la prestazione incongrua."
                ),
                at: 0
            )
            patient.updatedAt = now
            return patient
        }

        if currentIndex == patient.steps.indices.last {
            if var protocolState = patient.therapyProtocol, protocolState.currentCycle < protocolState.totalCycles {
                protocolState.currentCycle += 1
                protocolState.nextSession = Calendar.current.date(byAdding: .day, value: 21, to: now)
                patient.therapyProtocol = protocolState
                patient.timeline.insert(
                    TimelineEvent(
                        id: UUID().uuidString,
                        timestamp: now,
                        lane: "protocollo",
                        title: "Ciclo protocollo avanzato",
                        detail: "Il paziente e ora al ciclo \(protocolState.currentCycle) su \(protocolState.totalCycles)."
                    ),
                    at: 0
                )
                patient.updatedAt = now
            }
            return patient
        }

        patient.steps[currentIndex].status = .completed
        patient.steps[currentIndex + 1].status = .current
        patient.currentLocation = patient.steps[currentIndex + 1].owner
        patient.updatedAt = now

        let nextStep = patient.steps[currentIndex + 1]

        if nextStep.title.localizedCaseInsensitiveContains("Protocollo"), patient.therapyProtocol == nil {
            var protocolState = patient.track.therapyTemplate
            if settings.agendaIntegration {
                protocolState?.nextSession = Calendar.current.date(byAdding: .day, value: 7, to: now)
            }
            patient.therapyProtocol = protocolState
        }

        if settings.agendaIntegration, let bookingKind = nextStep.allowedBookings.first {
            patient.bookings.insert(
                BookingItem(
                    id: UUID().uuidString,
                    kind: bookingKind,
                    label: bookingKind.title,
                    scheduledFor: Calendar.current.date(byAdding: .day, value: 5, to: now) ?? now,
                    location: nextStep.owner,
                    owner: "CUP oncologico",
                    status: .scheduled
                ),
                at: 0
            )
        }

        if settings.autoPromoteReports, nextStep.title.localizedCaseInsensitiveContains("Board") {
            patient.alerts.insert(
                ClinicalAlert(
                    id: UUID().uuidString,
                    patientID: patient.id,
                    kind: .reportReady,
                    title: "Materiale pronto per board",
                    detail: "Il caso ha raggiunto lo step \(nextStep.title.lowercased()) ed e pronto per revisione clinica.",
                    createdAt: now,
                    owner: "Oncologia",
                    severity: .watch,
                    isResolved: false
                ),
                at: 0
            )
        }

        patient.timeline.insert(
            TimelineEvent(
                id: UUID().uuidString,
                timestamp: now,
                lane: "percorso",
                title: "Step avanzato",
                detail: "Il paziente e passato a \(nextStep.title)."
            ),
            at: 0
        )

        return patient
    }

    static func injectInvalidBooking(
        into originalPatient: PatientCase,
        settings: PrototypeSettings,
        now: Date = Date()
    ) -> PatientCase {
        var patient = originalPatient
        guard let currentStep = patient.currentStep else {
            return patient
        }

        let invalidKind = BookingKind.allCases.first(where: { !currentStep.allowedBookings.contains($0) }) ?? .petCT
        let invalidStatus: BookingStatus = settings.strictPathwayValidation ? .invalid : .pendingReview

        patient.bookings.insert(
            BookingItem(
                id: UUID().uuidString,
                kind: invalidKind,
                label: invalidKind.title,
                scheduledFor: Calendar.current.date(byAdding: .day, value: 2, to: now) ?? now,
                location: "Agenda condivisa",
                owner: "Operations",
                status: invalidStatus
            ),
            at: 0
        )

        if let currentIndex = patient.steps.firstIndex(where: isActionableStatus) {
            patient.steps[currentIndex].status = settings.strictPathwayValidation ? .attention : .current
        }

        patient.alerts.insert(
            ClinicalAlert(
                id: UUID().uuidString,
                patientID: patient.id,
                kind: .invalidBooking,
                title: "Prestazione non congrua",
                detail: "\(invalidKind.title) non e prevista nello step \(currentStep.title.lowercased()).",
                createdAt: now,
                owner: "CUP oncologico",
                severity: settings.strictPathwayValidation ? .critical : .watch,
                isResolved: false
            ),
            at: 0
        )

        patient.timeline.insert(
            TimelineEvent(
                id: UUID().uuidString,
                timestamp: now,
                lane: "operations",
                title: "Errore di agenda simulato",
                detail: "Inserita una prestazione non congrua per testare i guardrail del percorso."
            ),
            at: 0
        )
        patient.updatedAt = now

        return patient
    }

    static func simulateReportArrival(
        for originalPatient: PatientCase,
        settings: PrototypeSettings,
        now: Date = Date()
    ) -> PatientCase {
        guard settings.proactiveAlerts else {
            return originalPatient
        }

        var patient = originalPatient
        patient.alerts.insert(
            ClinicalAlert(
                id: UUID().uuidString,
                patientID: patient.id,
                kind: .reportReady,
                title: "Nuovo referto disponibile",
                detail: patient.lastReportSummary,
                createdAt: now,
                owner: "Oncologia",
                severity: .watch,
                isResolved: false
            ),
            at: 0
        )
        patient.timeline.insert(
            TimelineEvent(
                id: UUID().uuidString,
                timestamp: now,
                lane: "referti",
                title: "Referto acquisito",
                detail: "Il sistema ha generato un promemoria proattivo per il clinico."
            ),
            at: 0
        )
        patient.updatedAt = now
        return patient
    }

    static func requestReferral(
        for originalPatient: PatientCase,
        from fromService: String,
        to toService: String,
        note: String,
        now: Date = Date()
    ) -> PatientCase {
        var patient = originalPatient
        patient.referrals.insert(
            ReferralRecord(
                id: UUID().uuidString,
                fromService: fromService,
                toService: toService,
                requestedAt: now,
                note: note,
                state: .requested
            ),
            at: 0
        )
        patient.timeline.insert(
            TimelineEvent(
                id: UUID().uuidString,
                timestamp: now,
                lane: "referral",
                title: "Referral creato",
                detail: "\(fromService) -> \(toService)."
            ),
            at: 0
        )
        patient.updatedAt = now
        return patient
    }

    static func resolveAlert(
        in originalPatient: PatientCase,
        alertID: ClinicalAlert.ID,
        now: Date = Date()
    ) -> PatientCase {
        var patient = originalPatient
        guard let alertIndex = patient.alerts.firstIndex(where: { $0.id == alertID }) else {
            return patient
        }

        patient.alerts[alertIndex].isResolved = true

        let hasUnresolvedBookingAlert = patient.unresolvedAlerts.contains(where: { $0.kind == .invalidBooking })
        if !hasUnresolvedBookingAlert, let currentIndex = patient.steps.firstIndex(where: isActionableStatus) {
            if patient.steps[currentIndex].status == .attention || patient.steps[currentIndex].status == .blocked {
                patient.steps[currentIndex].status = .current
            }
        }

        patient.bookings = patient.bookings.map { booking in
            guard booking.status == .invalid || booking.status == .pendingReview else {
                return booking
            }
            var updated = booking
            updated.status = .scheduled
            return updated
        }

        patient.timeline.insert(
            TimelineEvent(
                id: UUID().uuidString,
                timestamp: now,
                lane: "inbox",
                title: "Alert risolto",
                detail: patient.alerts[alertIndex].title
            ),
            at: 0
        )
        patient.updatedAt = now
        return patient
    }

    static func consultation(
        for patient: PatientCase,
        role: PrototypeRole,
        settings: PrototypeSettings
    ) -> ConsultationBrief {
        let currentStep = patient.currentStep
        let unresolvedAlerts = patient.unresolvedAlerts

        let locationSummary = if let currentStep {
            "Il paziente si trova nello step '\(currentStep.title)' presso \(currentStep.owner)."
        } else {
            "Il percorso non ha uno step operativo attivo."
        }

        let conditionSummary: String
        if role.canViewClinicalDetail {
            conditionSummary = "\(patient.confirmedCondition). Ultimo focus: \(patient.lastReportSummary)"
        } else if role.canViewClinicalSummary {
            conditionSummary = "\(patient.confirmedCondition). Monitoraggio condiviso con nodo specialistico."
        } else {
            conditionSummary = "Vista amministrativa: stato clinico dettagliato non disponibile."
        }

        let nextSteps = nextActions(for: patient, role: role)
        let riskFlags = unresolvedAlerts.prefix(3).map { $0.title }
        let narrativePrefix = settings.intelligenceMode == .copilot ? "Copilot sintetico" : "Motore heuristico"
        let narrative = "\(narrativePrefix): priorita su \(nextSteps.first ?? "stabilizzare il percorso"), con \(riskFlags.isEmpty ? "nessun blocker critico attivo" : "\(riskFlags.count) segnalazioni aperte")."

        return ConsultationBrief(
            locationSummary: locationSummary,
            conditionSummary: conditionSummary,
            nextSteps: nextSteps,
            riskFlags: riskFlags.isEmpty ? ["Nessun blocker critico aperto"] : riskFlags,
            narrative: narrative
        )
    }

    static func stageBucket(for patient: PatientCase) -> String {
        guard let currentStep = patient.currentStep else {
            return "In follow-up"
        }

        let title = currentStep.title.lowercased()
        if title.contains("triage") || title.contains("inquadramento") || title.contains("accesso rapido") {
            return "Intake"
        }
        if title.contains("board") {
            return "Board"
        }
        if title.contains("protocollo") || title.contains("chemioterapia") {
            return "Protocollo"
        }
        return "Workup"
    }

    private static func nextActions(for patient: PatientCase, role: PrototypeRole) -> [String] {
        if role == .adminOperator {
            if let booking = patient.activeBookingIssues.first {
                return [
                    "Sanare la prenotazione \(booking.label.lowercased())",
                    "Allineare l'agenda con lo step \(patient.currentStep?.title.lowercased() ?? "attuale")",
                    "Verificare conferma referral e disponibilita slot"
                ]
            }
            return [
                "Confermare gli slot gia in agenda",
                "Verificare eventuali referti in arrivo",
                "Aggiornare lo storico amministrativo del paziente"
            ]
        }

        if let alert = patient.unresolvedAlerts.first {
            return [
                "Gestire l'alert: \(alert.title.lowercased())",
                "Confermare il prossimo snodo \(patient.currentStep?.title.lowercased() ?? "clinico")",
                "Condividere il caso con il nodo specialistico di riferimento"
            ]
        }

        if let currentStep = patient.currentStep {
            return [
                "Chiudere lo step \(currentStep.title.lowercased())",
                "Preparare il passaggio a \(nextStepTitle(after: currentStep.id, in: patient) ?? "follow-up")",
                "Verificare checklist e documentazione disponibili"
            ]
        }

        return ["Riesaminare il percorso", "Aggiornare il piano", "Consolidare lo storico clinico"]
    }

    private static func nextStepTitle(after currentStepID: String, in patient: PatientCase) -> String? {
        guard let currentIndex = patient.steps.firstIndex(where: { $0.id == currentStepID }),
              patient.steps.indices.contains(currentIndex + 1) else {
            return nil
        }
        return patient.steps[currentIndex + 1].title
    }

    private static func isActionableStatus(_ step: PathwayStep) -> Bool {
        step.status == .current || step.status == .attention || step.status == .blocked
    }
}
