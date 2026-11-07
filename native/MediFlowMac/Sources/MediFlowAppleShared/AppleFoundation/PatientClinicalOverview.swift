import SwiftUI

struct PatientClinicalOverview: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let detail: HomeBasePatientDetail

    private var therapies: [HomeBaseTherapySummary] {
        model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }
    }
    private var measures: [HomeBaseObservationSummary] {
        model.observations.filter { $0.deletedAt == nil }.sorted { $0.observedAt > $1.observedAt }
    }
    private var checkups: [HomeBaseCheckupSummary] {
        model.checkups.filter { $0.deletedAt == nil && $0.status == "pending" }.sorted { $0.date < $1.date }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            let diagnoses = PatientStructuredFields.diagnoses(detail.diagnoses)
            VStack(alignment: .leading, spacing: 0) {
            table("Problemi", count: model.isPatientFieldLocked(.diagnoses) || diagnoses.isUnreadable ? nil : diagnoses.count.map(String.init), identifier: "problems") {
                if model.isPatientFieldLocked(.diagnoses) {
                    Label("Diagnosi protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                        .accessibilityIdentifier("patient-diagnoses-locked")
                } else if diagnoses.isUnreadable {
                    Text("Diagnosi non leggibili.")
                } else if let values = diagnoses.values, !values.isEmpty {
                    ForEach(Array(values.enumerated()), id: \.offset) { _, diagnosis in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(diagnosis.code).codice().foregroundStyle(.secondary)
                            Text(diagnosis.description).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(minHeight: LumeGeometry.rowHeight)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(diagnosis.displayText)
                        .overlay(alignment: .bottom) { Divider() }
                    }
                } else {
                    Text("Nessuna diagnosi registrata.").foregroundStyle(.secondary)
                        .accessibilityIdentifier("patient-diagnoses-empty")
                }
            }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("patient-detail-diagnoses")
            table("Terapie attive", count: count(therapies.count, loaded: model.therapies.count), identifier: "therapies") {
                if therapies.isEmpty { Text("Nessuna terapia attiva caricata.").foregroundStyle(.secondary) }
                ForEach(therapies) { therapy in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(therapy.drugName).fontWeight(.semibold)
                        Spacer(minLength: 0)
                        Text(therapy.dosage).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: LumeGeometry.rowHeight)
                    .overlay(alignment: .bottom) { Divider() }
                }
            }
            table("Misure recenti", count: count(measures.count, loaded: model.observations.count), identifier: "measures") {
                if measures.isEmpty { Text("Nessuna misura caricata.").foregroundStyle(.secondary) }
                ForEach(measures) { measure in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(measure.display)
                            Spacer(minLength: 0)
                            Text("\(measure.value) \(measure.unitCode)").fontWeight(.semibold).monospacedDigit()
                        }
                        Text(ClinicalDatePresentation.day.string(from: measure.observedAt)).font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: LumeGeometry.rowHeight)
                    .overlay(alignment: .bottom) { Divider() }
                }
            }
            table("Controlli aperti", count: count(checkups.count, loaded: model.checkups.count), identifier: "checkups") {
                if checkups.isEmpty { Text("Nessun controllo aperto caricato.").foregroundStyle(.secondary) }
                ForEach(checkups) { checkup in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(checkup.title)
                        Spacer(minLength: 0)
                        Text(ClinicalDatePresentation.day.string(from: checkup.date)).font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(minHeight: LumeGeometry.rowHeight)
                    .overlay(alignment: .bottom) { Divider() }
                }
            }
        }
        .inkRegister()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("patient-clinical-overview")
    }

    private func count(_ value: Int, loaded: Int) -> String {
        ClinicalSignalCount.fromLoadedList(count: value, loadedCount: loaded,
            limit: PairedPatientsWorkspaceSupport.clinicalPreviewCap).displayText
    }

    private func table<Content: View>(_ title: String, count: String?, identifier: String,
                                      @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6)
                    .accessibilityIdentifier("patient-overview-title-\(identifier)")
                Spacer(minLength: 8)
                if let count { Text(count).font(.caption).foregroundStyle(.secondary).monospacedDigit() }
            }
            .accessibilityAddTraits(.isHeader)
            Divider()
            content()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("patient-overview-\(identifier)")
    }
}
