// @Codex
import SwiftUI

/* @Codex */
struct CachedPatientProfileView: View {
    let profile: HomeBasePatientDetail
    let metadata: HomeBasePatientCacheMetadata?
    let lockedFields: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Profilo offline · sola lettura", systemImage: "wifi.slash")
                .font(.headline)
            Text("\(profile.lastName) \(profile.firstName)")
                .font(.title2.bold())
            if let metadata {
                Text(metadata.reviewLine).font(.subheadline).foregroundStyle(.secondary)
            }
            Text("Ultimo profilo consultato sul Mac, versione \(profile.version). Diario, terapie, controlli, misure, prescrizioni e documenti richiedono il collegamento. Questa copia non consente modifiche o esportazioni.")
                .font(.subheadline)
            Divider()
            field("Data di nascita", profile.birthDate?.formatted(date: .numeric, time: .omitted))
            field("Codice fiscale", profile.taxCode)
            field("Indirizzo", profile.address)
            field("Telefono", profile.phone)
            field("Caregiver", profile.caregiver)
            field("Diagnosi", DiagnosesCodec.decode(profile.diagnoses).map(\.displayText).joined(separator: "\n"))
            field("Esenzioni", ExemptionCodesCodec.decode(profile.exemptions).joined(separator: ", "))
            field("Note", profile.notes)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("patient-cached-profile")
    }

    private func field(_ title: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold))
            if lockedFields.contains(title) {
                Label("Dato cifrato non leggibile", systemImage: "lock.fill")
            } else if let value, !value.isEmpty {
                Text(value)
            } else {
                Text("Non presente nella copia")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
