import Foundation

public enum FHIRJSONValue: Equatable, Codable {
    case object([String: FHIRJSONValue])
    case array([FHIRJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let object = try? container.decode([String: FHIRJSONValue].self) {
            self = .object(object)
        } else if let array = try? container.decode([FHIRJSONValue].self) {
            self = .array(array)
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public struct FHIRBundleInput: Decodable, Equatable {
    public let generatedAt: String
    public let patient: FHIRPatientInput
    public let entries: [FHIRClinicalEntryInput]
    public let therapies: [FHIRTherapyInput]
    public let checkups: [FHIRCheckupInput]
    public let observations: [FHIRObservationInput]
}

public struct FHIRPatientInput: Decodable, Equatable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let taxCode: String
    public let birthDate: String?
    public let address: String?
    public let phone: String?
    public let isArchived: Bool?
    public let caregiver: String?
    public let exemptions: [String]?
    public let diagnoses: [FHIRDiagnosisInput]?

    public init(
        id: String,
        firstName: String,
        lastName: String,
        taxCode: String,
        birthDate: String? = nil,
        address: String? = nil,
        phone: String? = nil,
        isArchived: Bool? = nil,
        caregiver: String? = nil,
        exemptions: [String]? = nil,
        diagnoses: [FHIRDiagnosisInput]? = nil
    ) {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.taxCode = taxCode
        self.birthDate = birthDate
        self.address = address
        self.phone = phone
        self.isArchived = isArchived
        self.caregiver = caregiver
        self.exemptions = exemptions
        self.diagnoses = diagnoses
    }
}

public struct FHIRDiagnosisInput: Decodable, Equatable {
    public let id: String?
    public let code: String
    public let description: String
    public let system: String
    public let date: String

    public init(id: String? = nil, code: String, description: String, system: String, date: String) {
        self.id = id
        self.code = code
        self.description = description
        self.system = system
        self.date = date
    }
}

public struct FHIRClinicalEntryInput: Decodable, Equatable {
    public let id: String
    public let patientId: String
    public let date: String
    public let type: String
    public let title: String?
    public let content: String
    public let deletedAt: String?
    public let metadata: FHIRClinicalEntryMetadata?
    public let setting: String?

    public init(
        id: String,
        patientId: String,
        date: String,
        type: String,
        title: String? = nil,
        content: String,
        deletedAt: String? = nil,
        metadata: FHIRClinicalEntryMetadata? = nil,
        setting: String? = nil
    ) {
        self.id = id
        self.patientId = patientId
        self.date = date
        self.type = type
        self.title = title
        self.content = content
        self.deletedAt = deletedAt
        self.metadata = metadata
        self.setting = setting
    }
}

public struct FHIRClinicalEntryMetadata: Decodable, Equatable {
    public let title: FHIRJSONValue?
    public let score: FHIRJSONValue?
    public let interpretation: FHIRJSONValue?

    public init(title: FHIRJSONValue? = nil, score: FHIRJSONValue? = nil, interpretation: FHIRJSONValue? = nil) {
        self.title = title
        self.score = score
        self.interpretation = interpretation
    }
}

public struct FHIRTherapyInput: Decodable, Equatable {
    public let id: String
    public let patientId: String
    public let drugName: String
    public let dosage: String
    public let motivation: String?
    public let status: String
    public let startDate: String
    public let endDate: String?

    public init(
        id: String,
        patientId: String,
        drugName: String,
        dosage: String,
        motivation: String? = nil,
        status: String,
        startDate: String,
        endDate: String? = nil
    ) {
        self.id = id
        self.patientId = patientId
        self.drugName = drugName
        self.dosage = dosage
        self.motivation = motivation
        self.status = status
        self.startDate = startDate
        self.endDate = endDate
    }
}

public struct FHIRCheckupInput: Decodable, Equatable {
    public let id: String
    public let patientId: String
    public let date: String
    public let title: String
    public let status: String?
}

public struct FHIRObservationInput: Decodable, Equatable {
    public let id: String
    public let patientId: String
    public let codeSystem: String
    public let code: String
    public let display: String
    public let unitSystem: String
    public let unitCode: String
    public let value: FHIRJSONValue
    public let notes: String?
    public let observedAt: String

    public init(
        id: String,
        patientId: String,
        codeSystem: String = "LOINC",
        code: String,
        display: String,
        unitSystem: String = "UCUM",
        unitCode: String,
        value: FHIRJSONValue,
        notes: String? = nil,
        observedAt: String
    ) {
        self.id = id
        self.patientId = patientId
        self.codeSystem = codeSystem
        self.code = code
        self.display = display
        self.unitSystem = unitSystem
        self.unitCode = unitCode
        self.value = value
        self.notes = notes
        self.observedAt = observedAt
    }
}

public enum FHIRBundleGenerator {
    public static func generate(input: FHIRBundleInput) -> FHIRJSONValue {
        let patientId = input.patient.id
        var entries: [FHIRJSONValue] = [
            entry(resource: patient(input.patient, generatedAt: input.generatedAt))
        ]

        for diagnosis in input.patient.diagnoses ?? [] {
            entries.append(entry(resource: condition(diagnosis, patientId: patientId)))
        }

        for clinicalEntry in input.entries where clinicalEntry.deletedAt == nil {
            entries.append(entry(resource: encounter(clinicalEntry, patientId: patientId)))
            if let observation = observation(clinicalEntry, patientId: patientId) {
                entries.append(entry(resource: observation))
            }
        }

        for therapy in input.therapies {
            entries.append(entry(resource: medicationStatement(therapy, patientId: patientId)))
        }

        for observation in input.observations {
            entries.append(entry(resource: structuredObservation(observation, patientId: patientId)))
        }

        return object([
            "resourceType": .string("Bundle"),
            "type": .string("collection"),
            "entry": .array(entries),
        ])
    }

    private static func patient(_ patient: FHIRPatientInput, generatedAt: String) -> FHIRJSONValue {
        object([
            "resourceType": .string("Patient"),
            "id": .string(patient.id),
            "active": .bool(!(patient.isArchived ?? false)),
            "identifier": .array([
                object([
                    "use": .string("official"),
                    "system": .string("http://hl7.it/sid/codice-fiscale"),
                    "value": .string(patient.taxCode),
                ])
            ]),
            "name": .array([
                object([
                    "use": .string("official"),
                    "family": .string(patient.lastName),
                    "given": .array([.string(patient.firstName)]),
                ])
            ]),
            "gender": .string("unknown"),
            "birthDate": patient.birthDate.map { .string(dateOnly($0)) },
            "address": patient.address.flatMap { $0.isEmpty ? nil : $0 }.map {
                .array([
                    object([
                        "use": .string("home"),
                        "text": .string($0),
                        "country": .string("IT"),
                    ])
                ])
            },
            "telecom": patient.phone.flatMap { $0.isEmpty ? nil : $0 }.map {
                .array([
                    object([
                        "system": .string("phone"),
                        "value": .string($0),
                        "use": .string("mobile"),
                    ])
                ])
            },
            "contact": patient.caregiver.flatMap { $0.isEmpty ? nil : $0 }.map {
                .array([
                    object([
                        "relationship": .array([object(["text": .string("Caregiver")])]),
                        "name": object(["text": .string($0)]),
                    ])
                ])
            },
            "meta": object([
                "lastUpdated": .string(iso(generatedAt)),
            ]),
        ])
    }

    private static func condition(_ diagnosis: FHIRDiagnosisInput, patientId: String) -> FHIRJSONValue {
        object([
            "resourceType": .string("Condition"),
            "id": .string(diagnosis.id ?? UUID().uuidString),
            "subject": object(["reference": .string("Patient/\(patientId)")]),
            "clinicalStatus": object([
                "coding": .array([
                    object([
                        "system": .string("http://terminology.hl7.org/CodeSystem/condition-clinical"),
                        "code": .string("active"),
                    ])
                ])
            ]),
            "code": object([
                "coding": .array([
                    object([
                        "system": .string(diagnosisSystem(diagnosis.system)),
                        "code": .string(diagnosis.code),
                        "display": .string(diagnosis.description),
                    ])
                ]),
                "text": .string(diagnosis.description),
            ]),
            "onsetDateTime": .string(iso(diagnosis.date)),
        ])
    }

    private static func encounter(_ entry: FHIRClinicalEntryInput, patientId: String) -> FHIRJSONValue {
        let isHome = entry.setting == "home"
        return object([
            "resourceType": .string("Encounter"),
            "id": .string(entry.id),
            "status": .string("finished"),
            "class": object([
                "system": .string("http://terminology.hl7.org/CodeSystem/v3-ActCode"),
                "code": .string(isHome ? "HH" : "AMB"),
                "display": .string(isHome ? "home health" : "ambulatory"),
            ]),
            "subject": object(["reference": .string("Patient/\(patientId)")]),
            "period": object([
                "start": .string(iso(entry.date)),
                "end": .string(iso(entry.date)),
            ]),
            "type": .array([object(["text": .string(entry.type)])]),
        ])
    }

    private static func observation(_ entry: FHIRClinicalEntryInput, patientId: String) -> FHIRJSONValue? {
        guard entry.type == "scale", let score = entry.metadata?.score else { return nil }
        return object([
            "resourceType": .string("Observation"),
            "id": .string("obs-\(entry.id)"),
            "status": .string("final"),
            "code": object(["text": entry.metadata?.title?.stringValue.map(FHIRJSONValue.string)]),
            "subject": object(["reference": .string("Patient/\(patientId)")]),
            "effectiveDateTime": .string(iso(entry.date)),
            "valueInteger": .number(Double(score.numberValue ?? 0)),
            "interpretation": .array([object(["text": entry.metadata?.interpretation?.stringValue.map(FHIRJSONValue.string)])]),
            "note": .array([object(["text": .string(entry.content)])]),
        ])
    }

    private static func medicationStatement(_ therapy: FHIRTherapyInput, patientId: String) -> FHIRJSONValue {
        object([
            "resourceType": .string("MedicationStatement"),
            "id": .string(therapy.id),
            "status": .string(therapy.status == "active" ? "active" : (therapy.status == "suspended" ? "on-hold" : "completed")),
            "medicationCodeableConcept": object(["text": .string(therapy.drugName)]),
            "subject": object(["reference": .string("Patient/\(patientId)")]),
            "effectivePeriod": object([
                "start": .string(iso(therapy.startDate)),
                "end": therapy.endDate.map { .string(iso($0)) },
            ]),
            "dosage": .array([object(["text": .string(therapy.dosage)])]),
            "note": therapy.motivation.map { .array([object(["text": .string($0)])]) },
        ])
    }

    private static func structuredObservation(_ observation: FHIRObservationInput, patientId: String) -> FHIRJSONValue {
        let numericValue = observation.value.numberValue
        return object([
            "resourceType": .string("Observation"),
            "id": .string("obs-structured-\(observation.id)"),
            "status": .string("final"),
            "code": object([
                "coding": .array([
                    object([
                        "system": .string("http://loinc.org"),
                        "code": .string(observation.code),
                        "display": .string(observation.display),
                    ])
                ]),
                "text": .string(observation.display),
            ]),
            "subject": object(["reference": .string("Patient/\(patientId)")]),
            "effectiveDateTime": .string(iso(observation.observedAt)),
            "valueQuantity": numericValue.map {
                object([
                    "value": .number($0),
                    "system": .string("http://unitsofmeasure.org"),
                    "code": .string(observation.unitCode),
                    "unit": .string(observation.unitCode),
                ])
            },
            "valueString": numericValue == nil ? .string(observation.value.stringForFHIR) : nil,
            "note": observation.notes.map { .array([object(["text": .string($0)])]) },
        ])
    }

    private static func entry(resource: FHIRJSONValue) -> FHIRJSONValue {
        object(["resource": resource])
    }

    private static func object(_ raw: [String: FHIRJSONValue?]) -> FHIRJSONValue {
        .object(raw.compactMapValues { $0 })
    }

    private static func diagnosisSystem(_ system: String) -> String {
        if system == "ICD-9" { return "http://hl7.org/fhir/sid/icd-9" }
        if system == "ICD-10" { return "http://hl7.org/fhir/sid/icd-10" }
        return "http://id.who.int/icd/release/11/mms"
    }

    private static func iso(_ raw: String) -> String {
        guard let date = HomeBaseDateCoding.parseISO8601(raw) else { return raw }
        return isoFormatter.string(from: date)
    }

    private static func dateOnly(_ raw: String) -> String {
        iso(raw).split(separator: "T", maxSplits: 1).first.map(String.init) ?? raw
    }

    private static let isoFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter
    }()
}

private extension FHIRJSONValue {
    var numberValue: Double? {
        switch self {
        case .number(let value):
            return value
        case .string(let value):
            return Double(value)
        default:
            return nil
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            if value.rounded() == value { return String(Int(value)) }
            return String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return "null"
        case .array, .object:
            return nil
        }
    }

    var stringForFHIR: String {
        stringValue ?? ""
    }
}
