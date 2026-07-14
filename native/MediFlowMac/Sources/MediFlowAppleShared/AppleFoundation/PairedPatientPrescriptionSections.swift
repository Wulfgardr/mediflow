import SwiftUI

/* @Codex */
struct PairedPatientPrescriptionSections: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    private let actionColumns = [GridItem(.adaptive(minimum: 150), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            servicePrescriptionsSection
            prostheticPrescriptionsSection
        }
    }

    private var servicePrescriptionsSection: some View {
        let counters = ServicePrescriptionFiltering.counters(
            prescriptions: model.servicePrescriptions,
            items: model.servicePrescriptionItems
        )
        return VStack(alignment: .leading, spacing: 10) {
            PairedPatientSectionHeader(model: model,
                title: "Prestazioni",
                subtitle: "Prescrizioni ordinate per data",
                systemImage: "cross.case",
                refreshIdentifier: "homebase-refresh-services-button"
            ) {
                Task { await model.loadSelectedPatientServicePrescriptions() }
            }
            PairedPatientCounterStrip(values: [
                ("Totale", counters.total),
                ("Voci", counters.items),
                ("Aperte", counters.open),
                ("Referti", counters.reports),
            ], identifier: "service-prescription-counters")

            if model.servicePrescriptions.isEmpty {
                Text("Nessuna prestazione registrata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.servicePrescriptions) { prescription in
                    servicePrescriptionRow(prescription)
                        .accessibilityIdentifier("service-prescription-row-\(prescription.id)")
                }
            }

            Divider()
            servicePrescriptionForm
            Text("Creazione unica. Dopo il salvataggio la modifica testuale resta sul web; dal client nativo sono disponibili solo le transizioni di stato previste.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var prostheticPrescriptionsSection: some View {
        let counters = ProstheticPrescriptionFiltering.counters(model.prostheticPrescriptions)
        return VStack(alignment: .leading, spacing: 10) {
            PairedPatientSectionHeader(model: model,
                title: "Protesica",
                subtitle: "Prescrizioni e collaudi",
                systemImage: "figure.walk.motion",
                refreshIdentifier: "homebase-refresh-prosthetics-button"
            ) {
                Task { await model.loadSelectedPatientProstheticPrescriptions() }
            }
            PairedPatientCounterStrip(values: [
                ("Totale", counters.total),
                ("Collaudi", counters.tests),
            ], identifier: "prosthetic-prescription-counters")

            if model.prostheticPrescriptions.isEmpty {
                Text("Nessuna prescrizione protesica.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.prostheticPrescriptions) { prescription in
                    prostheticPrescriptionRow(prescription)
                        .accessibilityIdentifier("prosthetic-prescription-row-\(prescription.id)")
                }
            }

            Divider()
            prostheticPrescriptionForm
            Text("Creazione manuale completa. Nessun edit post-create e nessun hard delete dal client nativo.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }


    private func servicePrescriptionRow(_ prescription: HomeBaseServicePrescriptionSummary) -> some View {
        let children = model.servicePrescriptionItems.filter { $0.prescriptionId == prescription.id }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(prescription.serviceName)
                        .font(.caption.weight(.semibold))
                    Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: prescription.prescribedAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                PairedPatientFlagChip(
                    PairedServicePrescriptionStatus.title(for: prescription.status),
                    tone: PairedServicePrescriptionStatus.tone(for: prescription.status)
                )
            }
            HStack(spacing: 6) {
                PairedPatientFlagChip(prescription.category, tone: .neutral)
                if let priority = prescription.priority?.trimmedOrNil {
                    PairedPatientFlagChip("Priorità \(priority.uppercased())", tone: .info)
                }
                if let code = prescription.serviceCode?.trimmedOrNil {
                    Text(code)
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            if let question = prescription.clinicalQuestion?.trimmedOrNil {
                Text(question)
                    .font(.caption)
                    .lineLimit(2)
            }
            if let provider = prescription.provider?.trimmedOrNil {
                Text("Erogatore: \(provider)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            serviceDatesLine(prescription)
            ForEach(children) { item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(item.ordinal).")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.serviceName)
                            .font(.caption)
                        if let code = item.serviceCode?.trimmedOrNil {
                            Text(code)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 6)
                    PairedPatientFlagChip(Self.serviceMatchLabel(item.matchStatus), tone: .info)
                }
                .accessibilityIdentifier("service-prescription-item-row-\(item.id)")
            }
            LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                Button("Prenota") {
                    Task { await model.bookServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canBookServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-book-\(prescription.id)")
                Button("Esegui") {
                    Task { await model.performServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canPerformServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-perform-\(prescription.id)")
                Button("Referto ricevuto") {
                    Task { await model.receiveServicePrescriptionReport(prescription) }
                }
                .font(.caption)
                .disabled(!model.canReceiveReportServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-report-\(prescription.id)")
                Button("Annulla") {
                    Task { await model.cancelServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canCancelServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-cancel-\(prescription.id)")
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private var servicePrescriptionForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Nuova prestazione", systemImage: "cross.case")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Prestazione principale", text: $model.newServiceName)
                .accessibilityIdentifier("new-service-name")
            HStack(spacing: 8) {
                TextField("Sistema codice", text: $model.newServiceCodeSystem)
                    .accessibilityIdentifier("new-service-code-system")
                TextField("Codice", text: $model.newServiceCode)
                    .accessibilityIdentifier("new-service-code")
            }
            Picker("Stato", selection: $model.newServiceStatus) {
                ForEach(PairedServicePrescriptionStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("new-service-status")
            HStack(spacing: 8) {
                Picker("Categoria", selection: $model.newServiceCategory) {
                    ForEach(PairedServicePrescriptionCategory.allCases) { category in
                        Text(category.title).tag(category)
                    }
                }
                .accessibilityIdentifier("new-service-category")
                Picker("Priorità", selection: $model.newServicePriority) {
                    ForEach(PairedServicePrescriptionPriority.allCases) { priority in
                        Text(priority.title).tag(priority)
                    }
                }
                .accessibilityIdentifier("new-service-priority")
            }
            DatePicker("Prescritta", selection: $model.newServicePrescribedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("new-service-prescribed-at")
            TextField("Quesito clinico", text: $model.newServiceClinicalQuestion)
                .accessibilityIdentifier("new-service-clinical-question")
            TextField("Erogatore", text: $model.newServiceProvider)
                .accessibilityIdentifier("new-service-provider")
            Toggle("Prenotata", isOn: $model.newServiceHasScheduledAt)
                .accessibilityIdentifier("new-service-has-scheduled-at")
            if model.newServiceHasScheduledAt {
                DatePicker("Prenotazione", selection: $model.newServiceScheduledAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-scheduled-at")
            }
            Toggle("Eseguita", isOn: $model.newServiceHasPerformedAt)
                .accessibilityIdentifier("new-service-has-performed-at")
            if model.newServiceHasPerformedAt {
                DatePicker("Esecuzione", selection: $model.newServicePerformedAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-performed-at")
            }
            Toggle("Referto ricevuto", isOn: $model.newServiceHasReportReceivedAt)
                .accessibilityIdentifier("new-service-has-report-at")
            if model.newServiceHasReportReceivedAt {
                DatePicker("Referto", selection: $model.newServiceReportReceivedAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-report-at")
            }
            TextField("Esito o note referto", text: $model.newServiceOutcomeNote)
                .accessibilityIdentifier("new-service-outcome")
            TextField("Numero richiesta", text: $model.newServiceRequestReference)
                .accessibilityIdentifier("new-service-request-reference")
            Picker("Fonte", selection: $model.newServiceSource) {
                ForEach(PairedPrescriptionSource.allCases) { source in
                    Text(source.title).tag(source)
                }
            }
            .accessibilityIdentifier("new-service-source")
            TextField("Riferimenti documento", text: $model.newServiceDocumentRefs)
                .accessibilityIdentifier("new-service-document-refs")
            TextField("Note", text: $model.newServiceNotes)
                .accessibilityIdentifier("new-service-notes")
            TextField("Voci, una per riga: CODICE NOME", text: $model.newServiceItemsText, axis: .vertical)
                .lineLimit(3...8)
                .accessibilityIdentifier("new-service-items")
            Button {
                Task { await model.createServicePrescriptionForSelectedPatient() }
            } label: {
                Label("Salva prestazione", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!model.canCreateServicePrescription)
            .accessibilityIdentifier("create-service-prescription-button")
        }
    }

    /* @Codex */
    private func prostheticPrescriptionRow(_ prescription: HomeBaseProstheticPrescriptionSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(prescription.description)
                        .font(.caption.weight(.semibold))
                    Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: prescription.prescribedAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                PairedPatientFlagChip(
                    PairedProstheticPrescriptionStatus.title(for: prescription.status),
                    tone: PairedProstheticPrescriptionStatus.tone(for: prescription.status)
                )
            }
            HStack(spacing: 6) {
                PairedPatientFlagChip(prescription.category, tone: .neutral)
                if let iso = prescription.isoCode?.trimmedOrNil {
                    Text(iso)
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            if let reason = prescription.clinicalReason?.trimmedOrNil {
                Text(reason)
                    .font(.caption)
                    .lineLimit(2)
            }
            if let measures = prescription.measures?.trimmedOrNil {
                Text("Misure: \(measures)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let supplier = prescription.supplier?.trimmedOrNil {
                Text("Fornitore: \(supplier)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let collaudo = prescription.collaudoAt {
                Text("Collaudo: \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: collaudo))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let outcome = prescription.collaudoOutcome?.trimmedOrNil {
                Text(outcome)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await model.markProstheticPrescriptionTested(prescription) }
            } label: {
                Label("Collaudo", systemImage: "checkmark.seal")
            }
            .font(.caption)
            .disabled(!model.canTestProstheticPrescription(prescription))
            .accessibilityIdentifier("prosthetic-test-\(prescription.id)")
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private var prostheticPrescriptionForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Nuova prescrizione protesica", systemImage: "figure.walk.motion")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Descrizione", text: $model.newProstheticDescription)
                .accessibilityIdentifier("new-prosthetic-description")
            HStack(spacing: 8) {
                TextField("Codice ISO", text: $model.newProstheticISOCode)
                    .accessibilityIdentifier("new-prosthetic-iso-code")
                Picker("Categoria", selection: $model.newProstheticCategory) {
                    ForEach(PairedProstheticPrescriptionCategory.allCases) { category in
                        Text(category.title).tag(category)
                    }
                }
                .accessibilityIdentifier("new-prosthetic-category")
            }
            Picker("Stato", selection: $model.newProstheticStatus) {
                ForEach(PairedProstheticPrescriptionStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("new-prosthetic-status")
            DatePicker("Prescritta", selection: $model.newProstheticPrescribedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("new-prosthetic-prescribed-at")
            TextField("Misure", text: $model.newProstheticMeasures)
                .accessibilityIdentifier("new-prosthetic-measures")
            TextField("Motivo clinico", text: $model.newProstheticClinicalReason)
                .accessibilityIdentifier("new-prosthetic-clinical-reason")
            TextField("Numero regionale", text: $model.newProstheticRegionalPrescriptionId)
                .accessibilityIdentifier("new-prosthetic-regional-id")
            TextField("Fornitore", text: $model.newProstheticSupplier)
                .accessibilityIdentifier("new-prosthetic-supplier")
            Toggle("Collaudo già registrato", isOn: $model.newProstheticHasCollaudoAt)
                .accessibilityIdentifier("new-prosthetic-has-collaudo")
            if model.newProstheticHasCollaudoAt {
                DatePicker("Collaudo", selection: $model.newProstheticCollaudoAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-prosthetic-collaudo-at")
                TextField("Esito collaudo", text: $model.newProstheticCollaudoOutcome)
                    .accessibilityIdentifier("new-prosthetic-collaudo-outcome")
            }
            Picker("Fonte", selection: $model.newProstheticSource) {
                ForEach(PairedPrescriptionSource.allCases) { source in
                    Text(source.title).tag(source)
                }
            }
            .accessibilityIdentifier("new-prosthetic-source")
            TextField("Riferimenti documento", text: $model.newProstheticDocumentRefs)
                .accessibilityIdentifier("new-prosthetic-document-refs")
            TextField("Note", text: $model.newProstheticNotes)
                .accessibilityIdentifier("new-prosthetic-notes")
            Button {
                Task { await model.createProstheticPrescriptionForSelectedPatient() }
            } label: {
                Label("Salva protesica", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!model.canCreateProstheticPrescription)
            .accessibilityIdentifier("create-prosthetic-prescription-button")
        }
    }

    /* @Codex */

    private func serviceDatesLine(_ prescription: HomeBaseServicePrescriptionSummary) -> some View {
        let values: [String] = [
            prescription.scheduledAt.map { "Prenotata \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: $0))" },
            prescription.performedAt.map { "Eseguita \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: $0))" },
            prescription.reportReceivedAt.map { "Referto \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: $0))" },
        ].compactMap { $0 }
        return Text(values.joined(separator: " · "))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .opacity(values.isEmpty ? 0 : 1)
    }

    /* @Codex */
    private static func serviceMatchLabel(_ rawValue: String) -> String {
        switch rawValue {
        case "matched":
            return "match"
        case "candidate":
            return "candidato"
        case "manual":
            return "manuale"
        default:
            return "da codificare"
        }
    }
}
