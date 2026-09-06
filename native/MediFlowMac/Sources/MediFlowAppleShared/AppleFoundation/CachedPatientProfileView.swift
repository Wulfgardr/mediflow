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
                .accessibilityHeading(.h1)
            if let metadata {
                Text(metadata.reviewLine).font(.subheadline).foregroundStyle(.secondary)
            }
            Text("Versione \(profile.version) acquisita dall’home-base. Le altre sezioni della cartella richiedono il collegamento.")
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

    @ViewBuilder
    private func field(_ title: String, _ value: String?) -> some View {
        // @Codex: Missing optional fields do not turn the historical profile into empty boxes.
        if lockedFields.contains(title) || value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                if lockedFields.contains(title) {
                    Label("Dato cifrato non leggibile", systemImage: "lock.fill")
                } else if let value {
                    Text(value)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}
