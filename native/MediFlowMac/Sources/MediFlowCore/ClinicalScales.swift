// A10: clinical scales ported from lib/scale-definitions.ts. A completed scale is
// stored exactly as the web stores it: a diary entry of type "scale" whose
// encrypted metadata carries { title, scaleId, score, interpretation, answers }.
// Pure and unit-tested; the view drives the questions and the model submits.
import Foundation

public struct ClinicalScaleOption: Equatable, Sendable {
    public let label: String
    public let value: Int
    public init(label: String, value: Int) {
        self.label = label
        self.value = value
    }
}

public struct ClinicalScaleQuestion: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let options: [ClinicalScaleOption]
}

public struct ClinicalScaleResult: Equatable {
    public let score: Int
    public let interpretation: String
    public let answers: [String: Int]
}

public struct ClinicalScaleDefinition: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let scaleDescription: String
    public let questions: [ClinicalScaleQuestion]
    // Total points if every question is answered with its maximum option.
    public var maxScore: Int {
        questions.reduce(0) { $0 + ($1.options.map(\.value).max() ?? 0) }
    }

    private let interpret: @Sendable (Int) -> String

    public init(
        id: String,
        title: String,
        scaleDescription: String,
        questions: [ClinicalScaleQuestion],
        interpret: @escaping @Sendable (Int) -> String
    ) {
        self.id = id
        self.title = title
        self.scaleDescription = scaleDescription
        self.questions = questions
        self.interpret = interpret
    }

    public static func == (lhs: ClinicalScaleDefinition, rhs: ClinicalScaleDefinition) -> Bool {
        lhs.id == rhs.id && lhs.questions == rhs.questions
    }

    /// Sum scoring (matches every ported scale's scoringLogic), then interpret.
    public func result(from answers: [String: Int]) -> ClinicalScaleResult {
        let score = questions.reduce(0) { $0 + (answers[$1.id] ?? 0) }
        return ClinicalScaleResult(score: score, interpretation: interpret(score), answers: answers)
    }
}

public enum ClinicalScales {
    /// ADL (Indice di Katz), ported field-for-field from lib/scale-definitions.ts.
    public static let adl = ClinicalScaleDefinition(
        id: "adl",
        title: "ADL (Indice di Katz)",
        scaleDescription: "Autonomia nelle attivita della vita quotidiana (1 = Autonomo, 0 = Dipendente).",
        questions: [
            choice("bath", "Fare il bagno"),
            choice("dress", "Vestirsi"),
            choice("toilet", "Uso del Bagno"),
            choice("transfer", "Spostarsi"),
            choice("cont", "Continenza"),
            choice("feed", "Alimentarsi"),
        ],
        interpret: { score in
            if score == 6 { return "Autonomia Conservata (6/6)" }
            if score >= 4 { return "Compromissione Lieve (4-5/6)" }
            if score >= 2 { return "Compromissione Moderata (2-3/6)" }
            return "Compromissione Grave (0-1/6)"
        }
    )

    /// Tinetti (Balance & Gait), ported field-for-field from lib/scale-definitions.ts.
    /// Note: the description says "Max 28 punti" but the option values sum to 24 (the
    /// web has the same discrepancy; maxScore is computed from the options, so it is 24).
    public static let tinetti = ClinicalScaleDefinition(
        id: "tinetti",
        title: "Scala Tinetti (Balance & Gait)",
        scaleDescription: "Valutazione del rischio di caduta (Equilibrio + Andatura). Max 28 punti.",
        questions: [
            q("b1", "Equilibrio seduto", [("0. Si inclina o scivola", 0), ("1. Fermo e sicuro", 1)]),
            q("b2", "Alzarsi dalla sedia", [("0. Impossibile senza aiuto", 0), ("1. Usa le braccia", 1), ("2. Senza usare le braccia", 2)]),
            q("b3", "Tentativi di alzarsi", [("0. Impossibile senza aiuto", 0), ("1. >1 tentativo", 1), ("2. Riesce al 1° tentativo", 2)]),
            q("b4", "Equilibrio immediato in piedi (primi 5 sec)", [("0. Instabile", 0), ("1. Stabile (base larga/ausilio)", 1), ("2. Stabile (base stretta)", 2)]),
            q("b5", "Equilibrio in piedi prolungato", [("0. Instabile", 0), ("1. Stabile (base larga)", 1), ("2. Stabile (piedi uniti)", 2)]),
            q("b6", "Nudging (spinta leggera sterno)", [("0. Cade", 0), ("1. Vacilla", 1), ("2. Stabile", 2)]),
            q("b7", "Occhi chiusi (in piedi)", [("0. Instabile", 0), ("1. Stabile", 1)]),
            q("b8", "Giro di 360 gradi", [("0. Passi discontinui/instabile", 0), ("1. Continuo/Stabile", 1)]),
            q("b9", "Sedersi", [("0. Insicuro", 0), ("1. Usa braccia", 1), ("2. Sicuro/Fluido", 2)]),
            q("g1", "Inizio andatura", [("0. Esitazione", 0), ("1. Nessuna esitazione", 1)]),
            q("g2", "Lunghezza/Altezza Passo (DX)", [("0. Non supera SX", 0), ("1. Supera SX", 1)]),
            q("g3", "Lunghezza/Altezza Passo (SX)", [("0. Non supera DX", 0), ("1. Supera DX", 1)]),
            q("g4", "Simmetria del passo", [("0. Asimmetrico", 0), ("1. Simmetrico", 1)]),
            q("g5", "Continuità del passo", [("0. Discontinuo", 0), ("1. Continuo", 1)]),
            q("g6", "Traiettoria", [("0. Deviazione marcata", 0), ("1. Lieve/Ausilio", 1), ("2. Diritta senza ausilio", 2)]),
            q("g7", "Tronco", [("0. Oscillazione/Flessione", 0), ("1. Stabile", 1)]),
            q("g8", "Cammino (Talloni)", [("0. Distanziati", 0), ("1. Quasi si toccano", 1)]),
        ],
        interpret: { score in
            if score <= 18 { return "ALTO Rischio di Caduta (< 19)" }
            if score <= 24 { return "MEDIO Rischio di Caduta (19-24)" }
            return "BASSO Rischio di Caduta (> 24)"
        }
    )

    /// IADL (Indice di Lawton), ported field-for-field from lib/scale-definitions.ts.
    public static let iadl = ClinicalScaleDefinition(
        id: "iadl",
        title: "IADL (Indice di Lawton)",
        scaleDescription: "Attività Strumentali della vita quotidiana (1 = F, 0 = NF). Nota: Storicamente 8 item per donne, 5 per uomini.",
        questions: [
            q("q1", "1. Capace di usare il telefono", [("0. No (non usa/non risponde)", 0), ("1. Si (chiama/risponde autonomamente)", 1)]),
            q("q2", "2. Fare acquisti", [("0. No (incapace/accompagnato)", 0), ("1. Si (provvede autonomamente)", 1)]),
            q("q3", "3. Preparazione cibo", [("0. No (non cucina/riscalda)", 0), ("1. Si (pianifica/prepara/serve)", 1)]),
            q("q4", "4. Governo della casa", [("0. No (non fa nulla/aiuto)", 0), ("1. Si (mantiene casa/piccoli lavori)", 1)]),
            q("q5", "5. Bucato", [("0. No (tutto da terzi)", 0), ("1. Si (lava/stira piccole cose)", 1)]),
            q("q6", "6. Mezzi di trasporto", [("0. No (non viaggia/taxi accompagnato)", 0), ("1. Si (usa mezzi pubblici/guida)", 1)]),
            q("q7", "7. Assunzione farmaci", [("0. No (incapace/preparati da altri)", 0), ("1. Si (responsabile per dosi/orari)", 1)]),
            q("q8", "8. Gestione finanze", [("0. No (incapace)", 0), ("1. Si (gestisce conto/spese)", 1)]),
        ],
        interpret: { score in
            "Punteggio totale: \(score)/8. (Minore è il punteggio, maggiore è la dipendenza strumentale)."
        }
    )

    /// MMSE (Folstein), ported field-for-field from lib/scale-definitions.ts.
    public static let mmse = ClinicalScaleDefinition(
        id: "mmse",
        title: "MMSE (Folstein)",
        scaleDescription: "Mini-Mental State Examination. Somministrazione standardizzata.",
        questions: [
            q("ot1", "In che anno siamo?", [("Erra", 0), ("Corretto", 1)]),
            q("ot2", "In che stagione?", [("Erra", 0), ("Corretto", 1)]),
            q("ot3", "In che mese?", [("Erra", 0), ("Corretto", 1)]),
            q("ot4", "In che giorno del mese?", [("Erra", 0), ("Corretto", 1)]),
            q("ot5", "In che giorno della settimana?", [("Erra", 0), ("Corretto", 1)]),
            q("os1", "In che stato siamo?", [("Erra", 0), ("Corretto", 1)]),
            q("os2", "In che regione?", [("Erra", 0), ("Corretto", 1)]),
            q("os3", "In che città?", [("Erra", 0), ("Corretto", 1)]),
            q("os4", "In che luogo siamo (ospedale/casa/studio)?", [("Erra", 0), ("Corretto", 1)]),
            q("os5", "A che piano siamo?", [("Erra", 0), ("Corretto", 1)]),
            q("reg1", "Ripete \"PALLA\"?", [("No", 0), ("Sì", 1)]),
            q("reg2", "Ripete \"BANDIERA\"?", [("No", 0), ("Sì", 1)]),
            q("reg3", "Ripete \"ALBERO\"?", [("No", 0), ("Sì", 1)]),
            q("att1", "100 - 7 (93)?", [("No", 0), ("Sì", 1)]),
            q("att2", "93 - 7 (86)?", [("No", 0), ("Sì", 1)]),
            q("att3", "86 - 7 (79)?", [("No", 0), ("Sì", 1)]),
            q("att4", "79 - 7 (72)?", [("No", 0), ("Sì", 1)]),
            q("att5", "72 - 7 (65)?", [("No", 0), ("Sì", 1)]),
            q("rec1", "Ricorda \"PALLA\"?", [("No", 0), ("Sì", 1)]),
            q("rec2", "Ricorda \"BANDIERA\"?", [("No", 0), ("Sì", 1)]),
            q("rec3", "Ricorda \"ALBERO\"?", [("No", 0), ("Sì", 1)]),
            q("lang1", "Denomina OROLOGIO", [("No", 0), ("Sì", 1)]),
            q("lang2", "Denomina MATITA", [("No", 0), ("Sì", 1)]),
            q("lang3", "Ripete \"SOPRA LA PANCA LA CAPRA CAMPA\"", [("No", 0), ("Sì (Esatta)", 1)]),
            q("lang4", "Comando triplo (Prendi foglio, piega, posa)", [("0/3", 0), ("1/3", 1), ("2/3", 2), ("3/3", 3)]),
            q("lang5", "Legge ed esegue \"CHIUDA GLI OCCHI\"", [("No", 0), ("Sì", 1)]),
            q("lang6", "Scrive una frase (Sogg + Pred)", [("No", 0), ("Sì", 1)]),
            q("lang7", "Copia il disegno (Pentagoni)", [("No", 0), ("Sì (Angoli/Intersezione)", 1)]),
        ],
        interpret: { score in
            if score >= 24 { return "Assenza di decadimento cognitivo (24-30)" }
            if score >= 18 { return "Decadimento Lieve-Moderato (18-23)" }
            if score >= 10 { return "Decadimento Moderato-Grave (10-17)" }
            return "Decadimento Grave (< 10)"
        }
    )

    /// GDS-15 (Geriatric Depression Scale), ported field-for-field from
    /// lib/scale-definitions.ts. Positive items (g1/g5/g7/g11/g13) map Si->0, No->+1;
    /// the rest map No->0, Si->+1. Preserve the per-item option order exactly.
    public static let gds = ClinicalScaleDefinition(
        id: "gds",
        title: "GDS (Geriatric Depression Scale 15)",
        scaleDescription: "Scala depressione. Risposte in grassetto = Depressive (+1).",
        questions: [
            q("g1", "1. È soddisfatto della sua vita?", [("Sì", 0), ("No (+1)", 1)]),
            q("g2", "2. Ha rinunciato a molte attività?", [("No", 0), ("Sì (+1)", 1)]),
            q("g3", "3. Sente che la sua vita è vuota?", [("No", 0), ("Sì (+1)", 1)]),
            q("g4", "4. Si annoia spesso?", [("No", 0), ("Sì (+1)", 1)]),
            q("g5", "5. È di buon umore gran parte del tempo?", [("Sì", 0), ("No (+1)", 1)]),
            q("g6", "6. Teme le accada qualcosa di brutto?", [("No", 0), ("Sì (+1)", 1)]),
            q("g7", "7. Si sente felice gran parte del tempo?", [("Sì", 0), ("No (+1)", 1)]),
            q("g8", "8. Si sente spesso impotente?", [("No", 0), ("Sì (+1)", 1)]),
            q("g9", "9. Preferisce stare a casa?", [("No", 0), ("Sì (+1)", 1)]),
            q("g10", "10. Problemi di memoria più di altri?", [("No", 0), ("Sì (+1)", 1)]),
            q("g11", "11. Pensa sia meraviglioso essere vivi?", [("Sì", 0), ("No (+1)", 1)]),
            q("g12", "12. Si sente inutile così com'è?", [("No", 0), ("Sì (+1)", 1)]),
            q("g13", "13. Si sente pieno di energie?", [("Sì", 0), ("No (+1)", 1)]),
            q("g14", "14. Pensa che la sua situazione sia senza speranza?", [("No", 0), ("Sì (+1)", 1)]),
            q("g15", "15. Pensa che gli altri stiano meglio?", [("No", 0), ("Sì (+1)", 1)]),
        ],
        interpret: { score in
            if score <= 5 { return "Normale (0-5)" }
            if score <= 10 { return "Depressione Lieve (6-10)" }
            return "Depressione Severa (11-15)"
        }
    )

    // Web library order = Object.values(SCALES) = [tinetti, adl, iadl, mmse, gds].
    public static let all: [ClinicalScaleDefinition] = [tinetti, adl, iadl, mmse, gds]

    // Multi-option question factory (Tinetti/MMSE have 3/4-way options; GDS inverts
    // per-item order), building options from (label, value) tuples in order.
    private static func q(_ id: String, _ text: String, _ options: [(String, Int)]) -> ClinicalScaleQuestion {
        ClinicalScaleQuestion(
            id: id, text: text,
            options: options.map { ClinicalScaleOption(label: $0.0, value: $0.1) }
        )
    }

    private static func choice(_ id: String, _ text: String) -> ClinicalScaleQuestion {
        ClinicalScaleQuestion(
            id: id, text: text,
            options: [
                ClinicalScaleOption(label: "Dipendente", value: 0),
                ClinicalScaleOption(label: "Autonomo", value: 1),
            ]
        )
    }

    /// The entry metadata JSON the web persists for a scale, byte-shape matching
    /// app/patients/[id]/scales/[scaleId]/page.tsx so the web can read it back.
    public static func metadataJSON(definition: ClinicalScaleDefinition, result: ClinicalScaleResult) -> String? {
        let payload = ScaleMetadata(
            title: definition.title,
            scaleId: definition.id,
            score: result.score,
            interpretation: result.interpretation,
            answers: result.answers
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(payload) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func contentSummary(definition: ClinicalScaleDefinition, result: ClinicalScaleResult) -> String {
        "Valutazione \(definition.title) completata.\nPunteggio: \(result.score)\nInterpretazione: \(result.interpretation)"
    }

    private struct ScaleMetadata: Encodable {
        let title: String
        let scaleId: String
        let score: Int
        let interpretation: String
        let answers: [String: Int]
    }
}
