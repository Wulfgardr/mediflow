// @Codex MF085-002: NHS FPS 006 V1 (2012-07); see ADR 0118. Local unvalidated Italian rendering.
import Foundation

public extension ClinicalScales {
    static let tinettiPOMA28ID = "tinetti-poma28-v1"
    static let tinettiPOMA28Instrument = ClinicalScaleInstrumentProvenance(
        instrumentId: "tinetti-poma",
        instrumentVersion: "poma28-16b12g",
        definitionVersion: "mediflow.poma28.v1",
        sourceId: "shrops-nhs-fps006-v1-2012-07",
        sourceUrl: "https://www.shropscommunityhealth.nhs.uk/content/doclib/10756.pdf",
        sourceDocumentVersion: "FPS 006 Physio Tinetti Form V1, July 2012",
        language: "it-IT",
        translationStatus: "local-unvalidated",
        riskClassification: "not-classified"
    )
    static let tinettiNonclassification = "Punteggio POMA-28: interpretazione clinica richiesta; nessuna classificazione automatica del rischio."
    static let tinettiPOMA28V1 = ClinicalScaleDefinition(
        id: tinettiPOMA28ID,
        title: "Tinetti POMA-28 (v1)",
        scaleDescription: "POMA-28 v1: equilibrio 16 + andatura 12, in 20 componenti di punteggio. Iniziare da seduti su sedia rigida senza braccioli; in piedi con il terapista, camminare al passo abituale e tornare a passo rapido ma sicuro, con l’ausilio abituale. Resa italiana locale non validata. Fonte: NHS FPS 006 V1 (luglio 2012).",
        questions: [
            q("poma28v1.balance.sitting", "Equilibrio da seduto", [("0. Si inclina o scivola", 0), ("1. Fermo e sicuro", 1)]),
            q("poma28v1.balance.rise", "Alzarsi dalla sedia", [("0. Impossibile senza aiuto", 0), ("1. Usa le braccia", 1), ("2. Senza usare le braccia", 2)]),
            q("poma28v1.balance.attempts", "Tentativi di alzarsi", [("0. Impossibile senza aiuto", 0), ("1. Più di un tentativo", 1), ("2. Un solo tentativo", 2)]),
            q("poma28v1.balance.immediate", "Equilibrio immediato in piedi (primi 5 secondi)", [("0. Instabile: barcolla, muove i piedi o oscilla con il tronco", 0), ("1. Stabile con deambulatore o altro sostegno", 1), ("2. Stabile senza sostegno", 2)]),
            q("poma28v1.balance.standing", "Equilibrio in piedi", [("0. Instabile", 0), ("1. Stabile con base larga e sostegno", 1), ("2. Base stretta senza sostegno", 2)]),
            q("poma28v1.balance.nudge", "Spinta: piedi più vicini possibile, tre leggere spinte sullo sterno", [("0. Inizia a cadere", 0), ("1. Vacilla, si aggrappa o recupera", 1), ("2. Stabile", 2)]),
            q("poma28v1.balance.eyesClosed", "Occhi chiusi, piedi più vicini possibile", [("0. Instabile", 0), ("1. Stabile", 1)]),
            q("poma28v1.balance.turnContinuity", "Giro di 360°: continuità dei passi", [("0. Passi discontinui", 0), ("1. Passi continui", 1)]),
            q("poma28v1.balance.turnStability", "Giro di 360°: stabilità", [("0. Instabile: si aggrappa o barcolla", 0), ("1. Stabile", 1)]),
            q("poma28v1.balance.sitDown", "Sedersi", [("0. Insicuro: valuta male la distanza o cade sulla sedia", 0), ("1. Usa le braccia o movimento non fluido", 1), ("2. Sicuro e fluido", 2)]),
            q("poma28v1.gait.initiation", "Avvio del cammino dopo il via", [("0. Esitazione o più tentativi", 0), ("1. Nessuna esitazione", 1)]),
            q("poma28v1.gait.rightLength", "Passo destro: lunghezza", [("0. Il piede destro in oscillazione non supera il sinistro in appoggio", 0), ("1. Il piede destro supera il sinistro", 1)]),
            q("poma28v1.gait.rightClearance", "Passo destro: distacco dal suolo", [("0. Il piede destro non si stacca completamente dal pavimento", 0), ("1. Il piede destro si stacca completamente dal pavimento", 1)]),
            q("poma28v1.gait.leftLength", "Passo sinistro: lunghezza", [("0. Il piede sinistro in oscillazione non supera il destro in appoggio", 0), ("1. Il piede sinistro supera il destro", 1)]),
            q("poma28v1.gait.leftClearance", "Passo sinistro: distacco dal suolo", [("0. Il piede sinistro non si stacca completamente dal pavimento", 0), ("1. Il piede sinistro si stacca completamente dal pavimento", 1)]),
            q("poma28v1.gait.symmetry", "Simmetria della lunghezza dei passi", [("0. Lunghezze diverse", 0), ("1. Lunghezze uguali", 1)]),
            q("poma28v1.gait.continuity", "Continuità del passo", [("0. Arresti o discontinuità", 0), ("1. Passi continui", 1)]),
            q("poma28v1.gait.path", "Traiettoria: osservare per 10 piedi, con riferimento alle piastrelle", [("0. Deviazione marcata", 0), ("1. Deviazione lieve/moderata o uso di ausilio", 1), ("2. Diritta senza ausilio", 2)]),
            q("poma28v1.gait.trunk", "Tronco durante il cammino", [("0. Oscillazione marcata o uso di ausilio", 0), ("1. Nessuna oscillazione, ma flessione delle ginocchia o braccia allargate per stabilizzarsi", 1), ("2. Nessuna oscillazione, flessione, uso delle braccia o di ausilio", 2)]),
            q("poma28v1.gait.heelSpacing", "Distanza tra i talloni durante il cammino", [("0. Talloni distanziati per stabilità", 0), ("1. Talloni quasi a contatto", 1)]),
        ],
        instrument: tinettiPOMA28Instrument,
        interpret: { _ in tinettiNonclassification }
    )
    // @Codex: these labels annotate history; they do not change its clinical content.
    static let legacyTinettiNotice = "Tinetti storica o senza provenienza verificabile: punteggio e interpretazione riportati come registrati, non rivalutati con POMA-28 v1."
    static let sourceBoundTinettiNotice = "POMA-28 v1 · NHS FPS 006 V1 (2012). Resa italiana locale non validata; nessuna classificazione automatica del rischio."

    static func tinettiHistoryNotice(
        scaleId: String?, title: String, instrument: ClinicalScaleInstrumentProvenance?
    ) -> String? {
        if scaleId == tinettiPOMA28ID && instrument == tinettiPOMA28Instrument {
            return sourceBoundTinettiNotice
        }
        return (scaleId?.lowercased().hasPrefix("tinetti") == true || title.lowercased().contains("tinetti"))
            ? legacyTinettiNotice : nil
    }
}
