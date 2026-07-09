import Foundation

/* @Codex */
public enum PopulationAgeBucket: String, CaseIterable, Equatable, Sendable {
    case zeroToEighteen = "0-18"
    case nineteenToSixtyFour = "19-64"
    case sixtyFiveToEighty = "65-80"
    case eightyPlus = "80+"
}

/* @Codex */
public struct PopulationPatient: Identifiable, Equatable, Sendable {
    public let id: String
    public let birthDate: Date?
    public let isAdi: Bool?
    public let diagnoses: [ClinicalDiagnosis]

    public init(id: String, birthDate: Date?, isAdi: Bool?, diagnoses: [ClinicalDiagnosis]) {
        self.id = id
        self.birthDate = birthDate
        self.isAdi = isAdi
        self.diagnoses = diagnoses
    }
}

/* @Codex */
public struct PopulationDiagnosisStat: Equatable, Sendable {
    public let key: String
    public let description: String
    public let system: String
    public let code: String
    public let count: Int

    public init(key: String, description: String, system: String, code: String, count: Int) {
        self.key = key
        self.description = description
        self.system = system
        self.code = code
        self.count = count
    }
}

/* @Codex */
public struct PopulationAnalyticsStats: Equatable, Sendable {
    public let totalInRange: Int
    public let withBirthDate: Int
    public let withoutBirthDate: Int
    public let adiCount: Int
    public let withDiagnoses: Int
    public let ageDistribution: [PopulationAgeBucket: Int]
    public let topDiagnoses: [PopulationDiagnosisStat]

    public init(totalInRange: Int, withBirthDate: Int, withoutBirthDate: Int, adiCount: Int, withDiagnoses: Int, ageDistribution: [PopulationAgeBucket: Int], topDiagnoses: [PopulationDiagnosisStat]) {
        self.totalInRange = totalInRange
        self.withBirthDate = withBirthDate
        self.withoutBirthDate = withoutBirthDate
        self.adiCount = adiCount
        self.withDiagnoses = withDiagnoses
        self.ageDistribution = ageDistribution
        self.topDiagnoses = topDiagnoses
    }
}

/* @Codex */
public enum PopulationAnalytics {
    public static func getAgeBucket(_ age: Int) -> PopulationAgeBucket {
        if age <= 18 { return .zeroToEighteen }
        if age <= 64 { return .nineteenToSixtyFour }
        if age <= 80 { return .sixtyFiveToEighty }
        return .eightyPlus
    }

    public static func normalizeAgeRange(_ range: ClosedRange<Int>) -> ClosedRange<Int> {
        range.lowerBound...range.upperBound
    }

    public static func normalizeAgeRange(_ range: (Int, Int)) -> (Int, Int) {
        range.0 <= range.1 ? range : (range.1, range.0)
    }

    public static func age(at now: Date, from birthDate: Date, calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.year], from: birthDate, to: now).year ?? 0
    }

    public static func percent(_ part: Int, total: Int) -> Int {
        guard total != 0 else { return 0 }
        return Int((Double(part) / Double(total) * 100).rounded())
    }

    public static func diagnosisKey(_ diagnosis: ClinicalDiagnosis) -> String {
        let system = diagnosis.system?.trimmedOrNil ?? "ICD"
        let code = diagnosis.code.trimmedOrNil ?? "senza-codice"
        let description = diagnosis.description.trimmedOrNil ?? code
        return "\(system):\(code):\(description.lowercased(with: Locale(identifier: "it_IT")))"
    }

    public static func statistics(
        for patients: [PopulationPatient],
        ageRange: (Int, Int),
        now: Date,
        calendar: Calendar = .current
    ) -> PopulationAnalyticsStats {
        let (minimumAge, maximumAge) = normalizeAgeRange(ageRange)
        var ageDistribution = Dictionary(uniqueKeysWithValues: PopulationAgeBucket.allCases.map { ($0, 0) })
        var diagnosisCounts: [String: PopulationDiagnosisStat] = [:]
        var diagnosisOrder: [String] = []
        var totalInRange = 0
        var withBirthDate = 0
        var withoutBirthDate = 0
        var adiCount = 0
        var withDiagnoses = 0

        for patient in patients {
            guard let birthDate = patient.birthDate else {
                withoutBirthDate += 1
                continue
            }
            withBirthDate += 1
            let patientAge = age(at: now, from: birthDate, calendar: calendar)
            guard patientAge >= minimumAge, patientAge <= maximumAge else { continue }

            totalInRange += 1
            if patient.isAdi == true { adiCount += 1 }
            ageDistribution[getAgeBucket(patientAge), default: 0] += 1

            if !patient.diagnoses.isEmpty {
                withDiagnoses += 1
                for diagnosis in patient.diagnoses {
                    let key = diagnosisKey(diagnosis)
                    if let current = diagnosisCounts[key] {
                        diagnosisCounts[key] = PopulationDiagnosisStat(key: current.key, description: current.description, system: current.system, code: current.code, count: current.count + 1)
                    } else {
                        let description = diagnosis.description.trimmedOrNil ?? diagnosis.code.trimmedOrNil ?? "Diagnosi senza descrizione"
                        diagnosisOrder.append(key)
                        diagnosisCounts[key] = PopulationDiagnosisStat(
                            key: key,
                            description: description,
                            system: diagnosis.system?.trimmedOrNil ?? "ICD",
                            code: diagnosis.code.trimmedOrNil ?? "n/d",
                            count: 1
                        )
                    }
                }
            }
        }

        return PopulationAnalyticsStats(
            totalInRange: totalInRange,
            withBirthDate: withBirthDate,
            withoutBirthDate: withoutBirthDate,
            adiCount: adiCount,
            withDiagnoses: withDiagnoses,
            ageDistribution: ageDistribution,
            topDiagnoses: diagnosisOrder.compactMap { diagnosisCounts[$0] }
                .enumerated()
                .sorted { left, right in
                    left.element.count == right.element.count ? left.offset < right.offset : left.element.count > right.element.count
                }
                .prefix(10)
                .map(\.element)
        )
    }
}
