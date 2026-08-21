---
summary: "How Lume was derived: the three GPT-5.6 market research lanes with sources, the cross-cutting findings, the rejected options, and the rationale of each Lume choice."
read_when:
  - "Questioning why Lume makes a given choice, or re-running the market research."
  - "Auditing the evidence behind the proposed design language."
---

# La derivazione

Metodo (2026-07-12): tre lane di ricerca web indipendenti su GPT-5.6 Terra via Codex CLI (due a effort high, una medium, sandbox in sola lettura), su indicazione e prompt di Fable; sintesi progettuale di Fable. Le lane hanno prodotto rapporti con fonti; qui il distillato e le decisioni.

## 1. Cosa dice la ricerca

### Lane R1: i prodotti premium 2025-2026

Prodotti sezionati: Linear (refresh 2026), Raycast, Arc e Dia, Amie, Notion Calendar/Mail, Family, Mercury, Ramp, Perplexity, ChatGPT desktop, Figma Slides/Buzz, iA Writer/Presenter, Things 3, Granola, Superhuman. Fonti principali: [Linear](https://linear.app/now/behind-the-latest-design-refresh), [Raycast](https://www.raycast.com/blog/the-new-raycast), [Dia](https://www.diabrowser.com/index), [Amie](https://amie.so/), [Notion Calendar](https://www.notion.com/en-gb/blog/introducing-notion-calendar), [Family](https://family.co/), [Mercury](https://mercury.com/), [iA](https://ia.net/writer/), [Things](https://culturedcode.com/things/), [Granola](https://www.granola.ai/blog/announcement), [Superhuman](https://superhuman.com/products/mail).

Pattern trasversali: il lusso è attenzione selettiva, non effetti (chrome e bordi recedono, il lavoro avanza); colore come semantica rara; tipografia editoriale con pochi pesi; densità adattabile (il premium può essere densissimo: Linear, Raycast, Ramp); motion breve, causale, reversibile; materiale dominante "soft flat" con vetro solo nel chrome di sistema. Durevole: gerarchia tonale, numeri ben composti, densità regolabile. Passeggero: glass ovunque, gradienti aurora senza funzione, bottoni AI scintillanti.

### Lane R2: la frontiera clinica

Prodotti: Function Health, Superpower, Oura, WHOOP, Apple Health, Abridge (Linked Evidence), Ambience, Nabla, Heidi, OpenEvidence, Epic Hyperdrive, Elation Note, Canvas Medical, Hint. Fonti principali: [Function](https://www.functionhealth.com/how-it-works), [Abridge Linked Evidence](https://support.abridge.com/hc/en-us/articles/30235128433811-Verify-a-Note-With-Linked-Evidence), [OpenEvidence](https://www.openevidence.com/), [Elation Note](https://help.elationhealth.com/articles/Elation-Note), [Canvas](https://docs.canvasmedical.com/sdk/companion/).

Pattern emergenti: progressive disclosure con home calma; baseline personale prima del benchmark generico; provenienza visibile per ogni contenuto generato (bozza, evidenza, revisione, firma come stati espliciti); densità a strati (riga -> pannello -> documento sorgente); colore come eccezione semantica. L'anatomia della riga di laboratorio fatta bene: nome, valore, unità, range con fonte, delta dal precedente comparabile, data. I cinque principi per un cockpit usato sei ore al giorno: testata invariabile, colonna dell'attenzione, dato prima dell'automazione, tastiera e continuità spaziale, fiducia locale-first ispezionabile.

### Lane R3: la frontiera estetica

Temi: post-glass (le critiche di leggibilità a Liquid Glass documentate da [WIRED](https://www.wired.com/story/designers-react-to-apple-liquid-glass/) e la correzione di Apple nelle beta), la luce come sistema (la HIG spaziale Apple: [Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/): profondità per importanza, temperatura e ombre come grammatica), texture e grana controllata ([Creative Bloq 2026](https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026)), estetica e-ink ([Mudita](https://mudita.com/community/blog/introducing-mudita-mindful-design/)), tipografia variabile e optical sizing ([Monotype](https://guillaume-rondet.com/wp-content/uploads/2025/12/Monotype_Revision_2025_Report_EN.pdf)), data-ink alla Tufte nelle interfacce dense, dark grafite (non nero puro) con contratto di contrasto ([Android AEP](https://developer.android.com/distribute/aep/aep-req-dark-theme)), interfacce che compongono viste per task con provenienza e revisione ([OpenAI Canvas](https://help.openai.com/en/articles/9930697-what-is-the-canvas-featue-in-chatgpt-and-how-do-i-use-it)). Chi definisce il gusto: Apple (materia e luce), Nothing (luce come linguaggio funzionale), BUCK, COLLINS, Pentagram (rigore editoriale-scientifico).

Gli otto ingredienti ad alto potenziale indicati dalla lane: profondità semantica, superfici opache intelligenti, scala neutra con blu minerale e un accento diagnostico, grana sub-percettiva, tipografia variabile con optical sizing, mono funzionale, densità Tufte, composizione di viste verificabili.

## 2. Le decisioni di Lume, una per una

| Scelta di Lume | Da dove viene |
| --- | --- |
| La luce come sistema di gerarchia (fuoco/penombra/buio operativo) | R3: la lezione spaziale Apple e Nothing; R1: la sidebar dimmer di Linear elevata a legge; il post-glass che chiede profondità selettiva senza blur |
| Superfici opache, vetro solo negli overlay | R1: il soft flat è il materiale del premium; R3: le critiche di leggibilità al vetro e la ritirata di Apple; R2: il dato clinico non tollera fondi instabili |
| Scala neutra giorno/grafite con accento minerale | La profondità usa luminanza, hairline e spazio; Carta resta grammatica documentale e non una palette |
| Il filo come firma, con tratto = stato epistemico | R2: la provenienza visibile (Abridge, Heidi) trasformata da badge a segno grafico; R1: l'identità ownable dei prodotti premium ottenuta con un solo gesto, non con effetti |
| Due voci (Voce + Registro mono per gli atomi verificabili) | R3: mono funzionale + variable type; R2: fiducia = dato distinguibile dal discorso; R1: i numeri ben composti di Mercury/Ramp |
| Grammatica dell'attenzione (testata, colonna, baseline, riga di laboratorio canonica) | R2, quasi integralmente: è il consenso della frontiera clinica |
| Motion = la luce si sposta | R1: motion breve e causale; R3: niente blur animato; costo e Reduce Motion quasi gratis |
| Raggi più asciutti (20/14/10) | R3: il "foglio tecnico" preciso; R1: iA e Notion Mail: la disciplina editoriale sostituisce l'ornamento |
| Grana sub-percettiva solo in periferia | R3: texture controllata, con il limite clinico esplicito (mai in zona lettura) |
| Densità Tufte e a strati | R1 + R2 + R3 convergono: la densità utile è più sicura delle card decorative |

## 3. Cosa è stato scartato, e perché

- **Vetro strutturale esteso (il paradigma attuale)**: contraddetto da tutte e tre le lane; persino la piattaforma che lo ha lanciato ne ha ridotto l'intensità. Resta come rendering idiomatico degli overlay Apple.
- **Gradienti aurora/mesh come identità**: convenzione da landing page, non da strumento clinico (R3); ammessi al massimo come "meteo luminoso" periferico, e Lume non ne ha bisogno.
- **Estetica pastello/gioiosa alla Amie**: il colore in clinica è semantica; la gioia di Lume sta nel motion misurato e nella luce, non nella palette (R1, nota su Amie).
- **Punteggi compositi e score alla Superpower come primo livello**: il dato e il ragionamento clinico non si sostituiscono con uno score (R2); la baseline personale è il confronto primario.
- **Nero puro OLED come default**: aggressivo e non più leggibile (R3); grafite con contratto di contrasto, il true black resta opzione.
- **Monospace come branding totale**: il mono è funzione (Registro), non stile totalizzante (R3).
- **UI generativa che si riconfigura da sola**: la composizione di viste per task è ammessa solo con orientamento stabile, fonti e revisione esplicita (R3, R2); nessuna gerarchia opaca.
- **Emoji come segnaletica**: fuori registro per il dominio (R1, nota su Amie).

## 4. Limiti della ricerca

Le misure tipografiche della lane R1 sono stime da interfacce pubbliche, non token ufficiali. Le lane sono state eseguite in una sola passata ciascuna (dopo due tentativi falliti per disconnessioni del backend); una seconda passata di verifica sulle singole fonti è prevista prima dell'ADR di adozione. I prompt integrali delle tre lane sono conservati nella sessione di lavoro del 2026-07-12.
