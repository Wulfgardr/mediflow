# Apple Intelligence per MediFlow: dettatura e sintesi on-device

Data: 2026-07-26
Stato: mappatura, nessuna decisione presa
Evidenza: SDK iOS 27.0 installato (`iphoneos27.0`, Xcode-beta), interfacce Swift
lette direttamente dal `.swiftmodule` — non dalla documentazione pubblica.

## Perche' questo documento non e' un ADR

Contiene un confine di privacy che non e' mio da attraversare. La mappa serve a
mettere Leonardo in condizione di decidere; la decisione resta sua.

## Cosa l'SDK espone davvero

Verificato in
`iPhoneOS.sdk/System/Library/Frameworks/`:

| Framework | Rilevanza |
|---|---|
| `FoundationModels.framework` | Modello linguistico di sistema. Sintesi, riscrittura, estrazione strutturata. |
| `Speech.framework` | Trascrizione. API basata su asset locali. |
| `Translation.framework` | Traduzione. Non pertinente ora. |
| `VisualIntelligence` / `MediaIntelligence` | Immagini. Possibile rilevanza futura per i referti fotografati. |

### FoundationModels: due modelli, non uno

Questo e' il ritrovamento che conta.

```
final public class SystemLanguageModel                    // @available(iOS 26.0)
  enum Availability.UnavailableReason {
      case deviceNotEligible
      case appleIntelligenceNotEnabled
      case modelNotReady
  }

final public class PrivateCloudComputeLanguageModel       // @available(iOS 27.0)
  enum Availability.UnavailableReason {
      case deviceNotEligible
  }
```

`SystemLanguageModel` gira sul dispositivo. `PrivateCloudComputeLanguageModel` e'
nuovo di iOS 27 e **manda il contenuto ai server di Apple**, con le garanzie
Private Cloud Compute — che sono buone garanzie, ma restano un trasferimento
fuori dal dispositivo.

Per MediFlow questi due non sono due opzioni della stessa funzione. Sono due cose
diverse:

- La cartella e' a conoscenza zero. I campi clinici sono cifrati con una chiave
  derivata dal PIN, che vive in RAM. Il backend non puo' leggerli per costruzione.
- Passare un diario clinico decifrato a PCC significa che il testo esce dal
  dispositivo in chiaro rispetto a MediFlow, indipendentemente da cosa fa Apple
  con esso.
- Non e' una regolazione di qualita': e' un cambio di modello di minaccia, e
  probabilmente un fatto da dichiarare al titolare del trattamento.

**Raccomandazione tecnica:** vincolare l'integrazione a `SystemLanguageModel` e
non compilare nemmeno il ramo PCC. Non "non usarlo per ora": non renderlo
raggiungibile. Un default che si puo' cambiare per errore, su questo confine, e'
una decisione presa per distrazione.

Nota utile: le `convenience init` di `LanguageModelSession` hanno
`model: SystemLanguageModel = .default`, quindi il percorso on-device e' quello
che si ottiene senza chiedere nulla. Il ramo PCC richiede di nominarlo
esplicitamente — il che rende un guard di build facile da scrivere.

### Speech: on-device per costruzione, non per opzione

L'interfaccia Swift di `Speech` in iOS 27 espone:

```
final public actor SpeechAnalyzer
final public class SpeechTranscriber      : SpeechModule, LocaleDependentSpeechModule
final public class DictationTranscriber   : SpeechModule, LocaleDependentSpeechModule
final public class SpeechDetector         : SpeechModule
final public class AssetInventory
    static func reserve(locale:) async throws -> Bool
    static func release(reservedLocale:) async -> Bool
    static func status(forModules:) async -> Status
    static func assetInstallationRequest(supporting:) async throws -> AssetInstallationRequest?
    static var maximumReservedLocales: Int
```

Due osservazioni verificate:

1. **`requiresOnDeviceRecognition` non esiste in questa interfaccia** (zero
   occorrenze). Era il flag con cui si chiedeva al vecchio `SFSpeechRecognizer` di
   non usare i server.
2. `SFSpeechRecognizer` **non compare nell'interfaccia Swift del modulo** (zero
   occorrenze). Cautela: il `.swiftinterface` non elenca necessariamente le classi
   importate da Objective-C, quindi questo dice che la superficie Swift moderna e'
   l'API ad asset, non che la classe legacy sia stata rimossa dal sistema.

Il meccanismo di `AssetInventory` — installare e *riservare* i modelli di lingua
sul dispositivo, con un tetto al numero di locale riservate — e' cio' che rende
questa API locale: il modello e' un asset scaricato, non un endpoint. E' la
proprieta' che serve a MediFlow, ed e' strutturale invece che opzionale.

`DictationTranscriber` con `ContentHint` e `volatileResults` copre esattamente il
caso "il medico detta mentre visita": risultati provvisori mostrati durante il
parlato, testo consolidato alla fine.

## Come si innesterebbe su cio' che esiste gia'

MediFlow ha gia' il posto giusto: la **bozza da trascrizione** nel comporre una
voce di diario. Oggi dice, correttamente, "Detta col microfono della tastiera di
sistema nel campo qui sotto, poi elabora la bozza. Nessun salvataggio automatico:
la bozza va rivista prima di essere inserita nella voce."

Quella frase e' il contratto giusto e va conservata parola per parola. La bozza e'
una bozza: nessun testo generato o trascritto entra nel referto senza che un
clinico lo abbia letto e confermato. Vale per la dettatura come per la sintesi.

Innesto in tre passi, dal piu' sicuro al piu' ambizioso:

**1. Dettatura locale continua** (`SpeechTranscriber` + `SpeechAnalyzer`)
Sostituisce il dettato della tastiera con una sessione gestita dall'app: si vede
lo stato, si mette in pausa, si sa che locale e' installata. Nessun testo lascia
il dispositivo. Nessun contenuto clinico passa da un modello generativo.
Rischio basso, beneficio immediato.

**2. Struttura S/O/A/P dal parlato** (`SystemLanguageModel`, output strutturato)
Il framework espone `Tool` e generazione guidata: si puo' chiedere al modello di
smistare una trascrizione nei quattro blocchi. Da presentare **come proposta nella
bozza**, mai come voce salvata. La correzione del template S/O/A/P di oggi e' il
precedente: struttura si', prosa inventata no.

**3. Sintesi** (`SystemLanguageModel`)
MediFlow ha gia' i campi `aiSummary` e `documentInsights`. Attenzione: il gate di
confidenza esplicita di WUL-361 e le regole sull'autofill ICD dicono che qui
esiste gia' una politica, e va rispettata, non aggirata.

## Cose da verificare prima di scrivere codice

Non le ho verificate, e non voglio che sembri il contrario:

- **Guardrail.** `FoundationModels` filtra i contenuti. Testo clinico —
  autolesionismo, abuso di sostanze, fine vita, dosaggi — puo' essere rifiutato o
  attenuato. Va misurato su casi reali prima di promettere qualcosa: un modello
  che si rifiuta di riassumere una nota psichiatrica e' peggio di nessun modello.
- **Requisito hardware.** `deviceNotEligible` esiste ma l'SDK non dichiara la
  soglia. Va letta dalla documentazione o misurata; la tua ipotesi A18 Pro in su e'
  plausibile ma non l'ho confermata.
- **Latenza e batteria** in visita domiciliare, a schermo acceso.
- **Vocabolario italiano clinico.** `ContentHint` accetta suggerimenti, ma quanto
  regga su farmaci e sigle ICD va provato.
- **Prestazione a confronto.** Il paragone con un Whisper locale va fatto sui
  referti veri, non in astratto.

## Cosa NON dovrebbe fare

- Nessuna scrittura automatica nella cartella. Mai.
- Nessun uso di PCC su contenuto clinico senza una decisione esplicita e
  documentata del titolare.
- Nessuna sintesi che sostituisca un campo compilato da un clinico.
- Nessun "riassunto" presentato come referto.

## Prossimo passo proposto

Un prototipo isolato del solo passo 1, dietro flag, che verifichi tre cose sul
simulatore e su un dispositivo reale: che la locale italiana si riservi, che la
trascrizione provvisoria arrivi, e che il testo consolidato entri nella bozza
esistente senza toccare il percorso di salvataggio. Niente modello generativo in
questo primo giro.
