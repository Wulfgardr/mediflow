// @Codex
import SwiftUI

/* @Codex */
struct EditPatientView: View {
    @EnvironmentObject private var security: SecuritySession
    @Environment(\.dismiss) private var dismiss

    let patient: PatientDetail
    let onSaved: () -> Void

    @State private var firstName: String
    @State private var lastName: String
    @State private var taxCode: String
    @State private var birthDate: Date
    @State private var includeBirthDate: Bool
    @State private var address = ""
    @State private var phone = ""
    @State private var caregiver = ""
    @State private var notes = ""
    @State private var isAdi: Bool
    @State private var isArchived: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var loadedSecureFields = false

    init(patient: PatientDetail, onSaved: @escaping () -> Void) {
        self.patient = patient
        self.onSaved = onSaved
        _firstName = State(initialValue: patient.firstName)
        _lastName = State(initialValue: patient.lastName)
        _taxCode = State(initialValue: patient.taxCode)
        _birthDate = State(initialValue: patient.birthDate ?? Date())
        _includeBirthDate = State(initialValue: patient.birthDate != nil)
        _isAdi = State(initialValue: patient.isAdi == true)
        _isArchived = State(initialValue: patient.isArchived == true)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Anagrafica") {
                    TextField("Nome", text: $firstName)
                        .accessibilityIdentifier("patient-edit-first-name")
                    TextField("Cognome", text: $lastName)
                        .accessibilityIdentifier("patient-edit-last-name")
                    TextField("Codice fiscale", text: $taxCode)
                        .accessibilityIdentifier("patient-edit-tax-code")

                    Toggle("Data di nascita", isOn: $includeBirthDate)
                        .disabled(patient.birthDate != nil)
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

                Section("Note") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 120)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") {
                    dismiss()
                }
                .accessibilityIdentifier("patient-edit-cancel-button")

                Spacer()

                Button(isSaving ? "Salvataggio..." : "Salva modifiche") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || !isValid)
                .accessibilityIdentifier("patient-edit-save-button")
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 560)
        .task {
            loadSecureFieldsIfNeeded()
        }
    }

    private var isValid: Bool {
        !trimmed(firstName).isEmpty && !trimmed(lastName).isEmpty && !trimmed(taxCode).isEmpty
    }

    /* @Codex */
    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        do {
            let encryptedAddress = try security.encryptString(trimmed(address))
            let encryptedPhone = try security.encryptString(trimmed(phone))
            let encryptedCaregiver = try security.encryptString(trimmed(caregiver))
            let encryptedNotes = try security.encryptString(trimmed(notes))

            try await LocalAPIClient.shared.updatePatient(
                id: patient.id,
                payload: UpdatePatientPayload(
                    firstName: trimmed(firstName),
                    lastName: trimmed(lastName),
                    taxCode: trimmed(taxCode).uppercased(),
                    birthDate: includeBirthDate ? birthDate : nil,
                    address: encryptedAddress,
                    phone: encryptedPhone,
                    caregiver: encryptedCaregiver,
                    exemptions: nil,
                    notes: encryptedNotes,
                    aiSummary: nil,
                    documentInsights: nil,
                    isAdi: isAdi,
                    isArchived: isArchived,
                    ambulatoryId: patient.ambulatoryId
                )
            )

            onSaved()
            dismiss()
        } catch {
            if let cryptoError = error as? CryptoService.CryptoError {
                errorMessage = cryptoError.message
            } else if let localError = error as? LocalAPIError {
                errorMessage = localError.localizedDescription
            } else {
                errorMessage = "Salvataggio modifiche fallito."
            }
        }
    }

    /* @Codex */
    private func loadSecureFieldsIfNeeded() {
        if loadedSecureFields { return }
        loadedSecureFields = true
        address = decryptOrPlain(patient.address)
        phone = decryptOrPlain(patient.phone)
        caregiver = decryptOrPlain(patient.caregiver)
        notes = decryptOrPlain(patient.notes)
    }

    /* @Codex */
    private func decryptOrPlain(_ value: String?) -> String {
        guard let value else { return "" }
        if value.isEmpty { return "" }
        if let decrypted = security.decryptString(value) {
            return decrypted
        }
        return value
    }

    private func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
