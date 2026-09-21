---
summary: "How Lume was derived: the three GPT-5.6 market research lanes with sources, the cross-cutting findings, the rejected options, and the rationale of each Lume choice."
read_when:
  - "Questioning why Lume makes a given choice, or re-running the market research."
  - "Auditing the evidence behind the proposed design language."
---

# La derivazione

La ricerca del 2026-07-12 è stata articolata in tre lane web indipendenti su GPT-5.6 Terra via Codex CLI, due a effort high e una medium, in sandbox di sola lettura. Fable ne ha definito indicazioni e prompt e ha curato la sintesi progettuale: questa pagina collega i risultati dei rapporti alle decisioni di Lume, conservandone fonti e limiti.

## 1. Cosa dice la ricerca

### Lane R1: i prodotti premium 2025-2026

La lane ha esaminato Linear (refresh 2026), Raycast, Arc e Dia, Amie, Notion Calendar/Mail, Family, Mercury, Ramp, Perplexity, ChatGPT desktop, Figma Slides/Buzz, iA Writer/Presenter, Things 3, Granola e Superhuman. I riferimenti principali sono [Linear](https://linear.app/now/behind-the-latest-design-refresh), [Raycast](https://www.raycast.com/blog/the-new-raycast), [Dia](https://www.diabrowser.com/index), [Amie](https://amie.so/), [Notion Calendar](https://www.notion.com/en-gb/blog/introducing-notion-calendar), [Family](https://family.co/), [Mercury](https://mercury.com/), [iA](https://ia.net/writer/), [Things](https://culturedcode.com/things/), [Granola](https://www.granola.ai/blog/announcement) e [Superhuman](https://superhuman.com/products/mail).

Nella lettura della lane, la qualità percepita dipende soprattutto da come venga selezionata l'attenzione: telaio e bordi arretrano, il colore compare di rado e con un significato, la tipografia usa pochi pesi. Ciò non impone una bassa densità, come mostrano Linear, Raycast e Ramp; richiede invece che sia adattabile. Anche il movimento è breve, causale e reversibile, mentre prevalgono superfici "soft flat" e il vetro resta nel chrome di sistema. La sintesi distingue quindi gli elementi durevoli — gerarchia tonale, composizione dei numeri, densità regolabile — dagli effetti più legati al momento, come vetro diffuso, gradienti aurora senza funzione e pulsanti AI scintillanti.

### Lane R2: la frontiera clinica

Per il contesto clinico sono stati esaminati Function Health, Superpower, Oura, WHOOP, Apple Health, Abridge (Linked Evidence), Ambience, Nabla, Heidi, OpenEvidence, Epic Hyperdrive, Elation Note, Canvas Medical e Hint. Le fonti principali sono [Function](https://www.functionhealth.com/how-it-works), [Abridge Linked Evidence](https://support.abridge.com/hc/en-us/articles/30235128433811-Verify-a-Note-With-Linked-Evidence), [OpenEvidence](https://www.openevidence.com/), [Elation Note](https://help.elationhealth.com/articles/Elation-Note) e [Canvas](https://docs.canvasmedical.com/sdk/companion/).

Il punto comune individuato dalla lane è che una prima vista calma non debba impoverire il dato: l'approfondimento procede dalla riga al pannello e al documento sorgente, mentre bozza, evidenza, revisione e firma restano stati espliciti. Il confronto parte dalla storia personale prima di ricorrere a un riferimento generico, e il colore segnala un'eccezione, non una categoria decorativa. Ne deriva anche l'anatomia della riga di laboratorio: nome, valore, unità, range con fonte, delta dal precedente comparabile e data. Per un cockpit usato sei ore al giorno, la sintesi raccoglie cinque principi: testata invariabile, colonna dell'attenzione, dato prima dell'automazione, tastiera con continuità spaziale e possibilità di ispezionare le garanzie locale-first.

### Lane R3: la frontiera estetica

La terza lane ha messo in relazione temi estetici e leggibilità: il post-glass, attraverso le critiche a Liquid Glass documentate da [WIRED](https://www.wired.com/story/designers-react-to-apple-liquid-glass/) e la correzione di Apple nelle beta; la luce come sistema di importanza, temperatura e ombre nella HIG spaziale Apple ([Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/)); texture e grana controllata ([Creative Bloq 2026](https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026)); estetica e-ink ([Mudita](https://mudita.com/community/blog/introducing-mudita-mindful-design/)); tipografia variabile e optical sizing ([Monotype](https://guillaume-rondet.com/wp-content/uploads/2025/12/Monotype_Revision_2025_Report_EN.pdf)). Completano il quadro il rapporto data-ink di Tufte nelle interfacce dense, il dark grafite anziché nero puro con un contratto di contrasto ([Android AEP](https://developer.android.com/distribute/aep/aep-req-dark-theme)) e le viste composte per un compito, con provenienza e revisione ([ChatGPT Canvas](https://help.openai.com/en/articles/9930697-what-is-the-canvas-featue-in-chatgpt-and-how-do-i-use-it)). I riferimenti di gusto individuati sono Apple per materia e luce, Nothing per la luce funzionale, BUCK, COLLINS e Pentagram per il rigore editoriale-scientifico.

Da questa ricognizione la lane ricava otto ingredienti da valutare insieme: profondità semantica, superfici opache intelligenti, palette da materiale — grafite, avorio freddo, blu minerale e un accento diagnostico —, grana appena percepibile, tipografia variabile con optical sizing, mono funzionale, densità secondo Tufte e composizione di viste verificabili.

## 2. Le decisioni di Lume, una per una

| Scelta di Lume | Da dove viene |
| --- | --- |
| La luce come sistema di gerarchia (fuoco/penombra/buio operativo) | R3: il rapporto fra spazio e luce in Apple e Nothing; R1: la sidebar attenuata di Linear diventa un criterio generale. Il post-glass orienta verso una profondità selettiva senza blur |
| Superfici opache, vetro solo negli overlay | R1: prevalenza del soft flat; R3: problemi di leggibilità del vetro e riduzione della sua intensità in Apple; R2: necessità di fondi stabili per il dato clinico |
| Palette avorio/grafite/minerale con gradiente di temperatura | R3: materiale e temperatura distinguono la profondità senza ricorrere alla decorazione |
| Il filo come firma, con tratto = stato epistemico | R2: la provenienza visibile in Abridge e Heidi viene tradotta da badge a segno grafico; R1: riconoscibilità affidata a un solo gesto anziché a più effetti |
| Due voci (Voce + Registro mono per gli atomi verificabili) | R3: mono funzionale e variable type; R2: dato distinguibile dal discorso; R1: composizione dei numeri in Mercury/Ramp |
| Grammatica dell'attenzione (testata, colonna, baseline, riga di laboratorio canonica) | R2: convergenza dei criteri ricavati dalla ricognizione clinica |
| Motion = la luce si sposta | R1: movimento breve e causale; R3: assenza di blur animato, con costo contenuto e gran parte di Reduce Motion già soddisfatta |
| Raggi più asciutti (20/14/10) | R3: precisione del foglio tecnico; R1: disciplina editoriale di iA e Notion Mail al posto dell'ornamento |
| Grana sub-percettiva solo in periferia | R3: texture controllata, mai nelle zone di lettura clinica |
| Densità Tufte e a strati | R1 + R2 + R3: preferenza per la densità utile rispetto alle card decorative |

## 3. Cosa è stato scartato, e perché

- **Vetro strutturale esteso (il paradigma esaminato)**: tutte e tre le lane ne mettono in discussione l'uso diffuso, anche alla luce della riduzione di intensità sulla piattaforma che lo ha introdotto. Rimane una resa idiomatica degli overlay Apple, non il materiale della struttura.
- **Gradienti aurora/mesh come identità**: la lane R3 li riconduce alla presentazione di una landing page, non allo strumento clinico. Sono ammessi al massimo come "meteo luminoso" periferico, ma Lume non ne ha bisogno.
- **Estetica pastello/gioiosa alla Amie**: poiché il colore ha un significato clinico, la qualità dell'esperienza viene cercata nel movimento misurato e nella luce, non nella palette (R1, nota su Amie).
- **Punteggi compositi e score alla Superpower come primo livello**: uno score non sostituisce il dato e il ragionamento clinico; il confronto primario resta la storia personale (R2).
- **Nero puro OLED come default**: la valutazione della lane R3 lo considera aggressivo, senza un vantaggio di leggibilità. Si sceglie quindi grafite con contratto di contrasto, lasciando il true black come opzione.
- **Monospace come branding totale**: il mono serve a distinguere il Registro, non a uniformare ogni contenuto (R3).
- **UI generativa che si riconfigura da sola**: comporre viste per un compito è ammesso solo mantenendo orientamento stabile, fonti e revisione esplicita; non sono ammesse gerarchie opache (R3, R2).
- **Emoji come segnaletica**: la ricognizione le considera estranee al registro del dominio clinico (R1, nota su Amie).

## 4. Limiti della ricerca

Le misure tipografiche di R1 sono stime ricavate da interfacce pubbliche, non token ufficiali. Ogni lane ha svolto una sola passata, dopo due tentativi falliti per disconnessioni del backend: la ricerca prevedeva quindi una seconda verifica delle singole fonti prima dell'ADR di adozione, senza che questa pagina ne attesti l'esecuzione. I prompt integrali delle tre lane sono conservati nella sessione di lavoro del 2026-07-12.