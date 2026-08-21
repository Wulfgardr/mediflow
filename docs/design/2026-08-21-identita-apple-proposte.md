---
summary: "Tre direzioni d'identità grafica per iOS/iPadOS/macOS coerenti con Lume — Carta, Guardia, Strumento — con raccomandazione (B su iPhone/iPadOS, C su macOS, materiali A come substrato) e piano di verifica per ciascuna."
read_when:
  - "Scegliendo l'identità visiva delle app Apple prima della delivery paired."
  - "Valutando temperamento, materiali e navigazione nativi oltre la mappa tecnica di 05-app-native.md."
---

# Identità Apple: tre direzioni, un temperamento

## 0. Perimetro e ordine delle evidenze

Queste sono **studi di direzione, non target**: nessuna autorizza codice SwiftUI
prima della verifica runtime. L'ordine delle evidenze resta quello di
[DESIGN.md](../../DESIGN.md): guida Apple → architettura/Lume/ADR → evidenza
runtime sul candidato esatto → craft secondario. Il blocco strumentale è
**risolto** (2026-08-21): il volume «Xcode Development» è montato, `MediFlowCore`
compila con Xcode 26.6, `native-test.sh` passa 560/560 e
`check:terminology-parity` 4/4 in locale — le verifiche della sezione 6 sono ora
eseguibili.

Base comune già fissata da [05-app-native.md](./lume/05-app-native.md), che
nessuna direzione tocca: `LumePalette` code-first dai token DTCG; SF Pro per la
Voce e SF Mono (`.registro()`) obbligatorio su dosi, valori, codici e date;
chrome di sistema lasciato al sistema (Liquid Glass dove la piattaforma lo
impone); segnali miscelati 60/40 con ink, minimo misurato 5,41:1.

## 1. Ciò che nessuna direzione nega

Modello focale (un fuoco per volta); penombra per le liste; buio operativo per
il telaio costruito; il Filo come connettore continuo; onestà degli stati;
44 pt ovunque; Dynamic Type fino ad AX5 con colonna singola quando serve.

---

## 2. Direzione A — Carta

**Concept: la quiete della carta clinica.** La materia più vicina al canone web:
superfici opache hairline, ombra solo sul fuoco, la tipografia come unico
ornamento. Il chrome recede del tutto; niente colore fuori dai segnali.

| Piattaforma | Anatomia |
| --- | --- |
| iPhone | Stack semplice, tab bar ≤5 voci, coda dell'attenzione come home; testata compressa a barra appuntata |
| iPadOS | Split list-detail classico: lista in penombra, dettaglio in fuoco; sidebar nativa |
| macOS | `NavigationSplitView` + `.inspector()` per il drill-down; toolbar nativa |

Carattere: sobrietà istituzionale. È la direzione a minor rischio di rigetto
(HIG-felice, review-felice) e a maggiore velocità di delivery paired.

Rischio proprio: **anonimato** — un buon client Mail clinico sembra questo.
Carta non possiede nulla che un concorrente non possa copiare domani.

Quando sceglierla: se l'obiettivo dominante è consegnare presto il canale paired
(WUL-546) con zero attrito estetico.

---

## 3. Direzione B — Guardia

**Concept: lo strumento del reperibile notturno.** Il registro guardia cessa di
essere una variante token e diventa identità operativa. Il setting d'uso principe
della medicina territoriale è la serata/notte in macchina e in ambulatorio
spento: Guardia è progettata da quel momento all'indietro.

Scelte distintive:

- **True-black OLED su iPhone** (`canvas #0c0e12` come base reale, non tema in
  più): risparmio batteria in reperibilità e gerarchia leggibile a braccio
  disteso nel buco dell'ambulatorio buio.
- **Coda dell'attenzione glanceable**: la home mostra solo ciò che chiede azione
  stanotte, con perché e scadenza; il resto si cerca, non si scrolle.
- **Grammatica tattile**: pattern haptic distinti per success/attention/critical
  — il feedback che funziona quando gli occhi sono sulla strada.
- **Target 48 pt sui percorsi d'urgenza** (chiamare, registrare osservazione,
  chiudere loop): i percorsi critici pagano densità in cambio di certezza.
- iPadOS: stessa anima a densità media, split view con fuoco persistente.
- macOS: **non Guardia** — segue la base Carta; la notte è affare del telefono.

Rischi: halation e contrasto su OLED vanno misurati sui pannelli reali;
dark-only stanca di giorno → commutazione ambientale automatica (guardia segue
il contesto, non una preferenza).

Quando sceglierla: se MediFlow deve avere un'identità **posseduta**, radicata
nel momento in cui il prodotto salva più tempo. È la direzione che nessun
gestionale ambulatoriale può imitare senza cambiarne il setting d'uso.

---

## 4. Direzione C — Strumento

**Concept: precisione da strumento professionale.** Nel solco dei pro apps:
la scrivania autorevole è un posto di lavoro, non una vetrina.

Scelte distintive:

- **macOS first**: barra comandi permanente (`⌘K` jump-to-patient, azioni),
  inspector a colonna fissa per il drill-down senza perdere il punto, tutto ciò
  che è dato è Registro-capable, tastiera completa su ogni flusso.
- **Densità reale a due livelli**: comoda/densa come asse utente, già previsto
  dalla lingua come asse indipendente dal fuoco — qui diventa prodotto.
- iPadOS pointer+keyboard: palette fluttuante, Apple Pencil per annotare sui
  documenti con provenienza del tratto.
- iPhone: **non questa direzione** — la densità alta non esiste in compact
  (decisione già scritta in 05-app-native.md §3).

Rischi: freddezza percepita; curva di apprendimento; feature-creep da «pro».

Quando sceglierla: se la home-base macOS deve diventare davvero il posto di
lavoro autoritativo dichiarato da PRODUCT.md (amministrazione, riconciliazione,
backup, workflow complessi).

---

## 5. Raccomandazione

**B su iPhone e iPadOS, C su macOS, i materiali di A come substrato comune.**
Un Lume, tre temperamenti: la carta tiene la pace, la guardia possiede la notte,
lo strumento possiede la scrivania. La coerenza d'identità viene dai token
condivisi e dalla grammatica (fuoco, Filo, Registro, onestà degli stati), non
dall'uniformità delle superfici — che PRODUCT.md esclude esplicitamente
(«parity ≠ pixel identity»).

## 6. Piano di verifica (per qualunque direzione scelta)

1. Collegare il disco Xcode (WUL-527): sblocca `swift build MediFlowCore`,
   probe di decodifica e ogni verifica SwiftUI alla cieca oggi impossibile.
2. Golden screenshot sintetici: direzione × registro × dispositivo × Dynamic
   Type AX5, fixture sintetiche soltanto.
3. Misura contrasto su pannello OLED reale per Guardia (halation compresa).
4. Run VoiceOver su iPhone per retrieve e record: oggi è boundary documentata
   in `docs/known-limitations.md`, nessuna direzione può dichiararla risolta
   senza terminale eseguito.
5. Parità di capability contro `docs/parity-matrix.md` — mai parità di pixel.
