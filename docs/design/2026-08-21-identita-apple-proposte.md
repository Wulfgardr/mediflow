---
summary: "Tre direzioni d'identità grafica per iOS/iPadOS/macOS coerenti con Lume — Carta, Guardia, Strumento — con raccomandazione (B su iPhone/iPadOS, C su macOS, materiali A come substrato) e piano di verifica per ciascuna."
read_when:
  - "Scegliendo l'identità visiva delle app Apple prima della delivery paired."
  - "Valutando temperamento, materiali e navigazione nativi oltre la mappa tecnica di 05-app-native.md."
---

# Identità Apple: tre direzioni, un temperamento

## 0. Perimetro e ordine delle evidenze

Questi sono **studi di direzione, non target**: servono a scegliere un
carattere visivo e nessuno autorizza codice SwiftUI prima della verifica
runtime. L'ordine resta quello di [DESIGN.md](../../DESIGN.md): guida Apple →
architettura/Lume/ADR → evidenza runtime sul candidato esatto → indicazioni
secondarie di realizzazione. Il blocco strumentale risulta **risolto** nella
verifica del 2026-08-21: il volume «Xcode Development» è montato,
`MediFlowCore` compila con Xcode 26.6, `native-test.sh` passa 560/560 e
`check:terminology-parity` 4/4 in locale. Su questa base le verifiche della
sezione 6 diventano eseguibili, non già eseguite.

Le direzioni non modificano la base fissata da
[05-app-native.md](./lume/05-app-native.md): `LumePalette` definita nel codice
dai token DTCG; SF Pro per la Voce e SF Mono (`.registro()`) obbligatorio su
dosi, valori, codici e date. Il sistema conserva i propri elementi di
navigazione e comando, incluso Liquid Glass dove la piattaforma lo impone;
i segnali sono miscelati 60/40 con ink, con minimo misurato 5,41:1.

## 1. Ciò che nessuna direzione nega

Qualunque direzione mantiene un solo fuoco per volta, penombra nelle liste
e buio operativo nel telaio costruito. Il Filo assicura continuità e gli stati
restano onesti; valgono inoltre 44 pt ovunque e Dynamic Type fino ad AX5,
passando a una colonna quando necessario.

---

## 2. Direzione A — Carta

**Concept: la quiete della carta clinica.** Carta si avvicina al canone web
attraverso superfici opache dai bordi sottili e ombra riservata al fuoco.
La tipografia porta il carattere della vista, mentre navigazione e comandi
arretrano e il colore compare soltanto nei segnali.

| Piattaforma | Anatomia |
| --- | --- |
| iPhone | Stack semplice, tab bar ≤5 voci, coda dell'attenzione come home; testata compressa a barra appuntata |
| iPadOS | Split list-detail classico: lista in penombra, dettaglio in fuoco; sidebar nativa |
| macOS | `NavigationSplitView` + `.inspector()` per il drill-down; toolbar nativa |

La sobrietà istituzionale rende Carta la direzione valutata a minor rischio
di rigetto nelle HIG e nella revisione, e la più rapida da consegnare
nel percorso paired.

Il limite della stessa scelta è **l'anonimato**: potrebbe somigliare a un
buon client Mail clinico, senza un tratto che un concorrente non possa
riprodurre.

Carta è quindi indicata quando prevalga l'obiettivo di consegnare presto
il canale paired (WUL-546), senza attrito estetico.

---

## 3. Direzione B — Guardia

**Concept: lo strumento del reperibile notturno.** Guardia parte da una
situazione d'uso territoriale precisa: la sera o la notte, fra automobile e
ambulatorio spento. Il registro guardia non è più soltanto una variante dei
token, ma il punto da cui costruire l'identità operativa.

Scelte distintive:

- **True-black OLED su iPhone** (`canvas #0c0e12` come base reale, non tema
  aggiuntivo): la proposta cerca risparmio di batteria in reperibilità e
  gerarchia leggibile a braccio disteso nell'ambulatorio buio.
- **Coda dell'attenzione leggibile a colpo d'occhio**: la home mostra soltanto
  ciò che richiede azione nella notte, con motivo e scadenza; il resto si cerca
  anziché scorrere tutta la lista.
- **Grammatica tattile**: pattern haptic distinti per success/attention/critical,
  per riconoscere il feedback anche quando lo sguardo non sia sullo schermo.
- **Target 48 pt sui percorsi d'urgenza** — chiamare, registrare un'osservazione,
  chiudere un loop — accettando minore densità in cambio di maggiore certezza.
- iPadOS conserva la stessa impostazione a densità media, con split view e
  fuoco persistente.
- macOS **non adotta Guardia**: segue la base Carta, mentre l'identità notturna
  riguarda il telefono.

Aloni e contrasto su OLED richiedono misure sui pannelli reali. Poiché una
superficie soltanto scura può affaticare di giorno, la proposta prevede una
commutazione ambientale automatica: Guardia segue il contesto, non una
preferenza fissa.

Guardia è indicata quando si cerchi un'identità **propria**, radicata nel
momento in cui il prodotto intende far risparmiare più tempo. La sua
distinzione nasce dal contesto d'uso, che un gestionale ambulatoriale non
potrebbe riprendere senza ripensare la propria impostazione.

---

## 4. Direzione C — Strumento

**Concept: precisione da strumento professionale.** Strumento segue la
tradizione delle applicazioni professionali: la scrivania autorevole deve
essere un posto in cui lavorare, non una vetrina.

Scelte distintive:

- **macOS first**: barra comandi permanente (`⌘K` per raggiungere paziente
  e azioni), inspector a colonna fissa per approfondire senza perdere il
  contesto, Registro disponibile per ogni dato e tastiera completa in ogni
  flusso.
- **Densità reale a due livelli**: comoda e densa diventano una scelta
  dell'utente, secondo l'asse già previsto dalla lingua come indipendente
  dal fuoco.
- Su iPadOS con puntatore e tastiera: palette fluttuante e Apple Pencil per
  annotare i documenti conservando la provenienza del tratto.
- Su iPhone **questa direzione non si applica**: la densità alta è esclusa
  nel formato compact, come già deciso in 05-app-native.md §3.

I rischi sono una maggiore freddezza percepita, una curva di apprendimento
più impegnativa e l'accumulo di funzioni giustificato dall'etichetta «pro».

Strumento è indicato quando la home-base macOS debba realizzare il ruolo
di postazione autorevole descritto da PRODUCT.md: amministrazione,
riconciliazione, backup e flussi complessi.

---

## 5. Raccomandazione

**B su iPhone e iPadOS, C su macOS, con i materiali di A come base comune.**
La raccomandazione adatta Lume a tre esigenze: quiete della lettura,
reperibilità e lavoro alla scrivania. L'identità resta riconoscibile grazie
a token e grammatica condivisi — fuoco, Filo, Registro e onestà degli stati —,
non all'uniformità delle superfici, che PRODUCT.md esclude esplicitamente
con «parity ≠ pixel identity».

## 6. Piano di verifica (per qualunque direzione scelta)

1. Collegare il disco Xcode (WUL-527), prerequisito di `swift build MediFlowCore`,
   prove di decodifica e verifiche SwiftUI. Il blocco iniziale a cui questo
   passaggio rispondeva è quello dichiarato risolto nella premessa.
2. Acquisire screenshot golden sintetici per direzione × registro × dispositivo
   × Dynamic Type AX5, usando soltanto fixture sintetiche.
3. Misurare il contrasto di Guardia su un pannello OLED reale, inclusi gli aloni.
4. Eseguire VoiceOver su iPhone per retrieve e record: il limite delle prove è
   documentato in `docs/known-limitations.md` e nessuna direzione può dichiararlo
   risolto senza un'esecuzione conclusa.
5. Verificare la parità delle capability rispetto a `docs/parity-matrix.md`,
   mai la parità dei pixel.