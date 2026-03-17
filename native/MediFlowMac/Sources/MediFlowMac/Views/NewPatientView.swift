// Codex: created 2026-02-01
import SwiftUI

struct NewPatientView: View {
    @EnvironmentObject private var security: SecuritySession
    @Environment(\.dismiss) private var dismiss

    let ambulatoryId: String?
    let onCreated: () -> Void

    @State private var firstName = ""
    @State private var lastName = ""
    @State private var taxCode = ""
    @State private var birthDate = Date()
    @State private var includeBirthDate = false
    @State private var address = ""
    @State private var phone = ""
    @State private var caregiver = ""
    /* @Codex */
    @State private var exemptionCodes: [String] = []
    @State private var notes = ""
    @State private var isAdi = false
    @State private var isArchived = false
    @State private var errorMessage: String?
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Anagrafica") {
                    TextField("Nome", text: $firstName)
                    TextField("Cognome", text: $lastName)
                    TextField("Codice fiscale", text: $taxCode)

                    Toggle("Data di nascita", isOn: $includeBirthDate)
                    if includeBirthDate {
                        DatePicker("", selection: $birthDate, displayedComponents: .date)
                            .labelsHidden()
                    }

                    Toggle("ADI", isOn: $isAdi)
                    Toggle("Archiviato", isOn: $isArchived)
                }

                Section("Contatti") {
                    TextField("Indirizzo", text: $address)
                    TextField("Telefono", text: $phone)
                    TextField("Caregiver", text: $caregiver)
                }

                /* @Codex */
                Section("Esenzioni") {
                    ExemptionSearchField(selectedCodes: $exemptionCodes)
                }

                Section("Note") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 120)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") {
                    dismiss()
                }

                Spacer()

                Button(isSaving ? "Salvataggio..." : "Salva") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || !isValid)
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 520)
    }

    private var isValid: Bool {
        !firstName.isEmpty && !lastName.isEmpty && !taxCode.isEmpty
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        do {
            let encryptedAddress = try security.encryptString(address)
            let encryptedPhone = try security.encryptString(phone)
            let encryptedCaregiver = try security.encryptString(caregiver)
            let exemptionsPayload = ExemptionCodesCodec.encode(exemptionCodes) ?? "[]"
            let encryptedExemptions = try security.encryptString(exemptionsPayload)
            let encryptedNotes = try security.encryptString(notes)

            let payload = CreatePatientPayload(
                firstName: firstName,
                lastName: lastName,
                taxCode: taxCode,
                birthDate: includeBirthDate ? birthDate : nil,
                address: encryptedAddress,
                phone: encryptedPhone,
                caregiver: encryptedCaregiver,
                /* @Codex */
                exemptions: encryptedExemptions,
                notes: encryptedNotes,
                isAdi: isAdi,
                isArchived: isArchived,
                ambulatoryId: ambulatoryId
            )

            _ = try await LocalAPIClient.shared.createPatient(payload: payload)
            onCreated()
            dismiss()
        } catch {
            if let cryptoError = error as? CryptoService.CryptoError {
                errorMessage = cryptoError.message
            } else {
                errorMessage = "Salvataggio fallito."
            }
        }
    }
}
