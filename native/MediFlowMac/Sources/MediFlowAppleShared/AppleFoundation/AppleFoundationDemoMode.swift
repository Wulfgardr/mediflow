#if DEBUG
import Foundation

/// Fully offline demo dataset, for working on the interface without a host.
///
/// Design work on this app kept stalling on infrastructure rather than on the
/// interface: the Keychain asks for authorization on every rebuild (each ad-hoc
/// signature is a new app to macOS), the home base has to be running, the paired
/// session expires, and the field crypto needs a master key. None of that says
/// anything about whether a list, a chart or a toolbar is right.
///
/// With `MEDIFLOW_APPLE_DEMO=1` the app reads nothing and reaches nothing: no
/// Keychain, no network, no session, no database. Every clinical surface is fed
/// from the fixtures below.
///
/// Debug-only, and never a substitute for verifying real behaviour: a demo
/// dataset can prove a layout, never a contract with the host.
enum AppleFoundationDemoMode {
    static var isActive: Bool {
        let environment = ProcessInfo.processInfo.environment
        return environment["MEDIFLOW_APPLE_DEMO"] == "1"
            || environment["MEDIFLOW_APPLE_UITEST_PATIENTS"] == "1"
    }

    /// Skips the stored-pairing read while still using the network, for working
    /// against a scratch home base without answering a Keychain panel on every
    /// rebuild. Explicit on purpose: an earlier version inferred this from the
    /// mere presence of pairing overrides, which is the kind of implicit
    /// behaviour that surprises whoever meets it next.
    static var skipsStoredPairing: Bool {
        isActive || ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN"] == "1"
    }

    /// Distinct from the UI-test fixture, which stays a fixed three rows because
    /// tests assert on it. The demo set is wide enough to judge a worklist:
    /// enough rows to scroll, names of different lengths, and the flags,
    /// diagnoses and states that change how a row is drawn.
    static var isDemoDataset: Bool {
        ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_DEMO"] == "1"
    }

    private static let base = Date(timeIntervalSince1970: 1_753_000_000)

    private struct Seed {
        let first: String
        let last: String
        let years: Int
        let adi: Bool
        let archived: Bool
        let diagnoses: String?
    }

    private static let seeds: [Seed] = [
        Seed(first: "Giulia", last: "Ferrari", years: 74, adi: true, archived: false,
             diagnoses: #"[{"code":"E11.9","description":"Diabete mellito tipo 2 non complicato"},{"code":"I10","description":"Ipertensione essenziale"}]"#),
        Seed(first: "Alessandro", last: "Benedetti", years: 68, adi: false, archived: false,
             diagnoses: #"[{"code":"J44.9","description":"Broncopneumopatia cronica ostruttiva"}]"#),
        Seed(first: "Maria Antonietta", last: "Della Valle Scarpetta", years: 91, adi: true, archived: false,
             diagnoses: #"[{"code":"F03","description":"Demenza non specificata"},{"code":"I50.9","description":"Scompenso cardiaco"},{"code":"N18.3","description":"Malattia renale cronica stadio 3"}]"#),
        Seed(first: "Paolo", last: "Rizzo", years: 55, adi: false, archived: false, diagnoses: nil),
        Seed(first: "Chiara", last: "Lombardi", years: 39, adi: false, archived: false,
             diagnoses: #"[{"code":"E03.9","description":"Ipotiroidismo"}]"#),
        Seed(first: "Vincenzo", last: "Esposito", years: 82, adi: true, archived: false,
             diagnoses: #"[{"code":"I48.0","description":"Fibrillazione atriale parossistica"},{"code":"Z95.0","description":"Portatore di pacemaker"}]"#),
        Seed(first: "Anna", last: "Greco", years: 66, adi: false, archived: false,
             diagnoses: #"[{"code":"M81.0","description":"Osteoporosi postmenopausale"}]"#),
        Seed(first: "Luca", last: "Marchetti", years: 47, adi: false, archived: false, diagnoses: nil),
        Seed(first: "Rosa", last: "Caruso", years: 88, adi: true, archived: false,
             diagnoses: #"[{"code":"G20","description":"Malattia di Parkinson"},{"code":"R26.2","description":"Difficolta alla deambulazione"}]"#),
        Seed(first: "Stefano", last: "Bianco", years: 61, adi: false, archived: false,
             diagnoses: #"[{"code":"I25.1","description":"Cardiopatia ischemica cronica"}]"#),
        Seed(first: "Elena", last: "Moretti", years: 34, adi: false, archived: false, diagnoses: nil),
        Seed(first: "Giuseppe", last: "Palumbo", years: 79, adi: false, archived: false,
             diagnoses: #"[{"code":"C61","description":"Neoplasia maligna della prostata"}]"#),
        Seed(first: "Teresa", last: "Fontana", years: 85, adi: true, archived: false,
             diagnoses: #"[{"code":"I63.9","description":"Esiti di ictus ischemico"}]"#),
        Seed(first: "Marco", last: "Villa", years: 52, adi: false, archived: false, diagnoses: nil),
        Seed(first: "Lucia", last: "Sanna", years: 71, adi: false, archived: false,
             diagnoses: #"[{"code":"K21.9","description":"Malattia da reflusso gastroesofageo"}]"#),
        Seed(first: "Domenico", last: "Ferraro", years: 93, adi: true, archived: false,
             diagnoses: #"[{"code":"F03","description":"Demenza non specificata"},{"code":"L89.2","description":"Lesione da pressione sacrale"}]"#),
        Seed(first: "Silvia", last: "Costa", years: 43, adi: false, archived: false, diagnoses: nil),
        Seed(first: "Antonio", last: "Gallo", years: 77, adi: false, archived: true,
             diagnoses: #"[{"code":"E11.9","description":"Diabete mellito tipo 2 non complicato"}]"#),
        Seed(first: "Franca", last: "Rinaldi", years: 69, adi: false, archived: true, diagnoses: nil),
        Seed(first: "Salvatore", last: "De Luca", years: 58, adi: false, archived: false,
             diagnoses: #"[{"code":"G40.9","description":"Epilessia non specificata"}]"#)
    ]

    static func patients() -> [HomeBasePatientSummary] {
        seeds.enumerated().map { index, seed in
            HomeBasePatientSummary(
                id: "demo-\(index)",
                firstName: seed.first,
                lastName: seed.last,
                birthDate: birthDate(yearsAgo: seed.years),
                taxCode: taxCode(index: index, seed: seed),
                isAdi: seed.adi,
                isArchived: seed.archived,
                version: 1,
                updatedAt: base.addingTimeInterval(Double(-index) * 7_200),
                diagnoses: seed.diagnoses
            )
        }
    }

    static func detail(for patient: HomeBasePatientSummary) -> HomeBasePatientDetail {
        let index = abs(patient.id.hashValue % max(seeds.count, 1))
        return HomeBasePatientDetail(
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: patient.birthDate,
            taxCode: patient.taxCode,
            address: addresses[index % addresses.count],
            phone: "+39 0\(2 + index % 6) \(1_000_000 + index * 13_577)",
            caregiver: patient.isAdi == true ? caregivers[index % caregivers.count] : nil,
            exemptions: patient.isAdi == true ? #"["048","C01"]"# : #"["013"]"#,
            diagnoses: patient.diagnoses,
            monitoringProfile: patient.isAdi == true ? "Domiciliare, accesso settimanale" : nil,
            statusReason: nil,
            notes: notes[index % notes.count],
            aiSummary: summaries[index % summaries.count],
            documentInsights: insights[index % insights.count],
            isAdi: patient.isAdi,
            isArchived: patient.isArchived,
            version: patient.version,
            ambulatoryId: "AMB-DEMO",
            createdAt: base.addingTimeInterval(-31_536_000),
            updatedAt: patient.updatedAt
        )
    }

    private static let addresses = [
        "Via Palestro 14, Milano", "Corso Garibaldi 3, Monza", "Via dei Mille 108, Sesto San Giovanni",
        "Piazza Mercato 7, Cinisello Balsamo", "Via Manzoni 61, Rho"
    ]
    private static let caregivers = ["Figlia, convivente", "Coniuge", "Assistente familiare, diurna", "Figlio, non convivente"]
    private static let notes = [
        "Compliance terapeutica buona. Rivalutare pressione al prossimo accesso.",
        "Riferisce astenia serale. Nessun segno di scompenso all'esame obiettivo.",
        "Famiglia collaborante. Concordato monitoraggio glicemico bisettimanale.",
        "Nessuna nota rilevante dall'ultimo accesso."
    ]
    private static let summaries = [
        "Quadro clinico stabile, terapia in corso ben tollerata.",
        "Peggioramento lieve della autonomia negli ultimi tre mesi.",
        "Parametri nella norma, nessun evento intercorrente segnalato."
    ]
    private static let insights = [
        "Referti recenti coerenti con il quadro noto, nessun nuovo reperto critico.",
        "Ultimo emocromo entro i limiti. Creatinina in lieve aumento rispetto al precedente.",
        "Nessun documento caricato dopo l'ultimo accesso ambulatoriale."
    ]

    private static func birthDate(yearsAgo: Int) -> Date {
        Calendar(identifier: .gregorian).date(byAdding: .year, value: -yearsAgo, to: base) ?? base
    }

    /// Structurally valid and obviously synthetic: a real-looking codice fiscale
    /// on a demo record invites someone to treat it as real.
    private static func taxCode(index: Int, seed: Seed) -> String {
        let letters = String((seed.last + "XXX").uppercased().prefix(3))
        return "DEMO\(letters)\(String(format: "%04d", index))X"
    }
}
#endif
