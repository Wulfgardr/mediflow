// @Codex MF085-002: source mapping and claim limits in ADR 0118. Not a validated translation.
import { withValidatedScoring, type ScaleInstrumentProvenance } from '../scale-validation';

export const TINETTI_POMA28_ID = 'tinetti-poma28-v1';
export const TINETTI_POMA28_INSTRUMENT: ScaleInstrumentProvenance = Object.freeze({
    "instrumentId": "tinetti-poma",
    "instrumentVersion": "poma28-16b12g",
    "definitionVersion": "mediflow.poma28.v1",
    "sourceId": "shrops-nhs-fps006-v1-2012-07",
    "sourceUrl": "https://www.shropscommunityhealth.nhs.uk/content/doclib/10756.pdf",
    "sourceDocumentVersion": "FPS 006 Physio Tinetti Form V1, July 2012",
    "language": "it-IT",
    "translationStatus": "local-unvalidated",
    "riskClassification": "not-classified"
});
export const TINETTI_NONCLASSIFICATION = "Punteggio POMA-28: interpretazione clinica richiesta; nessuna classificazione automatica del rischio.";
export const TINETTI_POMA28 = withValidatedScoring({
    id: TINETTI_POMA28_ID,
    title: 'Tinetti POMA-28 (v1)',
    description: "POMA-28 v1: equilibrio 16 + andatura 12, in 20 componenti di punteggio. Iniziare da seduti su sedia rigida senza braccioli; in piedi con il terapista, camminare al passo abituale e tornare a passo rapido ma sicuro, con l’ausilio abituale. Resa italiana locale non validata. Fonte: NHS FPS 006 V1 (luglio 2012).",
    instrument: TINETTI_POMA28_INSTRUMENT,
    questions: [
        {"id": "poma28v1.balance.sitting", "text": "Equilibrio da seduto", "type": "choice", "options": [{"label": "0. Si inclina o scivola", "value": 0}, {"label": "1. Fermo e sicuro", "value": 1}]},
        {"id": "poma28v1.balance.rise", "text": "Alzarsi dalla sedia", "type": "choice", "options": [{"label": "0. Impossibile senza aiuto", "value": 0}, {"label": "1. Usa le braccia", "value": 1}, {"label": "2. Senza usare le braccia", "value": 2}]},
        {"id": "poma28v1.balance.attempts", "text": "Tentativi di alzarsi", "type": "choice", "options": [{"label": "0. Impossibile senza aiuto", "value": 0}, {"label": "1. Più di un tentativo", "value": 1}, {"label": "2. Un solo tentativo", "value": 2}]},
        {"id": "poma28v1.balance.immediate", "text": "Equilibrio immediato in piedi (primi 5 secondi)", "type": "choice", "options": [{"label": "0. Instabile: barcolla, muove i piedi o oscilla con il tronco", "value": 0}, {"label": "1. Stabile con deambulatore o altro sostegno", "value": 1}, {"label": "2. Stabile senza sostegno", "value": 2}]},
        {"id": "poma28v1.balance.standing", "text": "Equilibrio in piedi", "type": "choice", "options": [{"label": "0. Instabile", "value": 0}, {"label": "1. Stabile con base larga e sostegno", "value": 1}, {"label": "2. Base stretta senza sostegno", "value": 2}]},
        {"id": "poma28v1.balance.nudge", "text": "Spinta: piedi più vicini possibile, tre leggere spinte sullo sterno", "type": "choice", "options": [{"label": "0. Inizia a cadere", "value": 0}, {"label": "1. Vacilla, si aggrappa o recupera", "value": 1}, {"label": "2. Stabile", "value": 2}]},
        {"id": "poma28v1.balance.eyesClosed", "text": "Occhi chiusi, piedi più vicini possibile", "type": "choice", "options": [{"label": "0. Instabile", "value": 0}, {"label": "1. Stabile", "value": 1}]},
        {"id": "poma28v1.balance.turnContinuity", "text": "Giro di 360°: continuità dei passi", "type": "choice", "options": [{"label": "0. Passi discontinui", "value": 0}, {"label": "1. Passi continui", "value": 1}]},
        {"id": "poma28v1.balance.turnStability", "text": "Giro di 360°: stabilità", "type": "choice", "options": [{"label": "0. Instabile: si aggrappa o barcolla", "value": 0}, {"label": "1. Stabile", "value": 1}]},
        {"id": "poma28v1.balance.sitDown", "text": "Sedersi", "type": "choice", "options": [{"label": "0. Insicuro: valuta male la distanza o cade sulla sedia", "value": 0}, {"label": "1. Usa le braccia o movimento non fluido", "value": 1}, {"label": "2. Sicuro e fluido", "value": 2}]},
        {"id": "poma28v1.gait.initiation", "text": "Avvio del cammino dopo il via", "type": "choice", "options": [{"label": "0. Esitazione o più tentativi", "value": 0}, {"label": "1. Nessuna esitazione", "value": 1}]},
        {"id": "poma28v1.gait.rightLength", "text": "Passo destro: lunghezza", "type": "choice", "options": [{"label": "0. Il piede destro in oscillazione non supera il sinistro in appoggio", "value": 0}, {"label": "1. Il piede destro supera il sinistro", "value": 1}]},
        {"id": "poma28v1.gait.rightClearance", "text": "Passo destro: distacco dal suolo", "type": "choice", "options": [{"label": "0. Il piede destro non si stacca completamente dal pavimento", "value": 0}, {"label": "1. Il piede destro si stacca completamente dal pavimento", "value": 1}]},
        {"id": "poma28v1.gait.leftLength", "text": "Passo sinistro: lunghezza", "type": "choice", "options": [{"label": "0. Il piede sinistro in oscillazione non supera il destro in appoggio", "value": 0}, {"label": "1. Il piede sinistro supera il destro", "value": 1}]},
        {"id": "poma28v1.gait.leftClearance", "text": "Passo sinistro: distacco dal suolo", "type": "choice", "options": [{"label": "0. Il piede sinistro non si stacca completamente dal pavimento", "value": 0}, {"label": "1. Il piede sinistro si stacca completamente dal pavimento", "value": 1}]},
        {"id": "poma28v1.gait.symmetry", "text": "Simmetria della lunghezza dei passi", "type": "choice", "options": [{"label": "0. Lunghezze diverse", "value": 0}, {"label": "1. Lunghezze uguali", "value": 1}]},
        {"id": "poma28v1.gait.continuity", "text": "Continuità del passo", "type": "choice", "options": [{"label": "0. Arresti o discontinuità", "value": 0}, {"label": "1. Passi continui", "value": 1}]},
        {"id": "poma28v1.gait.path", "text": "Traiettoria: osservare per 10 piedi, con riferimento alle piastrelle", "type": "choice", "options": [{"label": "0. Deviazione marcata", "value": 0}, {"label": "1. Deviazione lieve/moderata o uso di ausilio", "value": 1}, {"label": "2. Diritta senza ausilio", "value": 2}]},
        {"id": "poma28v1.gait.trunk", "text": "Tronco durante il cammino", "type": "choice", "options": [{"label": "0. Oscillazione marcata o uso di ausilio", "value": 0}, {"label": "1. Nessuna oscillazione, ma flessione delle ginocchia o braccia allargate per stabilizzarsi", "value": 1}, {"label": "2. Nessuna oscillazione, flessione, uso delle braccia o di ausilio", "value": 2}]},
        {"id": "poma28v1.gait.heelSpacing", "text": "Distanza tra i talloni durante il cammino", "type": "choice", "options": [{"label": "0. Talloni distanziati per stabilità", "value": 0}, {"label": "1. Talloni quasi a contatto", "value": 1}]}
    ],
    scoringLogic: answers => Object.values(answers).reduce<number>((sum, value) => sum + (value as number), 0),
    interpretation: () => TINETTI_NONCLASSIFICATION,
});
