<div align="center">

# Crediti e attribuzioni

**MediFlow è software originale**, ma il suo sviluppo si confronta con idee,
modelli e strumenti di altri. Dichiararli permette di capire da dove provenga
una scelta e quale contributo sia effettivamente entrato nel progetto: questa
pagina ne raccoglie ruolo, collegamento e licenza.

Una relazione di _ispirazione_ non equivale all'inclusione di un componente:
in quei casi l'implementazione di MediFlow è originale e non comprende asset,
codice o dati di terzi, salvo dove indicato.

</div>

---

## Ispirazione

Questi riferimenti hanno suggerito una forma o un metodo, senza che ne sia
stato importato il codice.

### Kree8: il look

![Ispirazione](https://img.shields.io/badge/relazione-ispirazione-8957e5)
[![kree8.studio](https://img.shields.io/badge/kree8.studio-111111)](https://www.kree8.studio/)

L'aspetto e la grammatica visiva del cockpit clinico — root web, palette,
ritmo e movimento — sono **derivati da Kree8** come ispirazione esterna.
La traduzione nel lavoro clinico e il modello di interazione sono invece
originali di MediFlow: non includono asset o codice di Kree8.

### ClinSeek: il metodo di benchmark

![Ispirazione](https://img.shields.io/badge/relazione-ispirazione-8957e5)
![Non importato](https://img.shields.io/badge/codice-non%20importato-6e7681)

Cercare le fonti prima di sintetizzarle è il metodo che MediFlow ha ripreso
da ClinSeek per una prova di benchmark sintetico sull'assorbimento delle
evidenze. L'ispirazione riguarda il metodo, non i materiali: nel runtime non
sono inclusi codice ClinSeek, dati MIMIC o modelli ClinSeek.

---

## Motore di registrazione della visita

La dettatura fluida e la successiva elaborazione della visita hanno questi
riferimenti, mentre cattura e trascrizione della 0.8.5 sono un'implementazione
propria, basata su Apple on-device per macOS 26+. Il percorso richiede consenso,
limita l'audio alla RAM entro i confini previsti e sottopone il testo a revisione.
Non integra codice Fluid o scritture cliniche automatiche; le prove di release
non includono l'uso di un microfono reale.

### Fluid

[![FluidVoice: GPLv3](https://img.shields.io/badge/FluidVoice-GPLv3-a42e2b?logo=gnu&logoColor=white)](https://github.com/altic-dev/FluidVoice)
[![FluidAudio: Apache 2.0](https://img.shields.io/badge/FluidAudio-Apache%202.0-1f6feb?logo=swift&logoColor=white)](https://github.com/FluidInference/FluidAudio)
![Fluid Intelligence: privato](https://img.shields.io/badge/Fluid%20Intelligence-privato-6e7681)

I riferimenti hanno ruoli distinti: FluidVoice riguarda la dettatura macOS
(GPLv3), FluidAudio è un SDK Swift per l'audio on-device (Apache 2.0), mentre
Fluid Intelligence riguarda il post-processing privato e non è integrato.

---

## Modelli AI usati localmente

L'esecuzione di questi modelli è locale; non comporta invii di dati
all'esterno per impostazione predefinita.

### ATHENA (ATHENA-R1-Qwen3-8B)

[![arXiv 2606.28692](https://img.shields.io/badge/arXiv-2606.28692-b31b1b?logo=arxiv&logoColor=white)](https://arxiv.org/abs/2606.28692)
[![mims-harvard/ATHENA: MIT](https://img.shields.io/badge/GitHub-mims--harvard%2FATHENA-181717?logo=github&logoColor=white)](https://github.com/mims-harvard/ATHENA)
[![Model: MIT](https://img.shields.io/badge/Hugging%20Face-ATHENA--R1--Qwen3--8B-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B)

Per il ragionamento terapeutico, MediFlow usa i pesi locali di ATHENA tramite
MLX e ne adotta la struttura del report (recommendation, evidence, reasoning,
caveats, trace). Il risultato della lane `mediflow.treatment_reasoning.v1`
resta una bozza da rivedere. La derivazione del modello è Qwen3-8B;
ToolUniverse e vLLM upstream non sono integrati.

### Qwen3

[![Qwen3-8B: Apache 2.0](https://img.shields.io/badge/Hugging%20Face-Qwen3--8B%20Apache%202.0-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/Qwen/Qwen3-8B)

Qwen3 è la famiglia di modelli testuali usata come opzione locale predefinita
e come base di ATHENA.

### DeepSeek (riferimento OCR opzionale)

[![deepseek-ocr](https://img.shields.io/badge/deepseek--ocr-opzionale-4d6bfe)](https://ollama.com/library/deepseek-ocr)

DeepSeek è un riferimento per un adapter OCR locale opzionale, non una
qualifica del percorso: DeepSeek-OCR 2/CUDA e la sua qualifica restano
`OUT_OF_SCOPE_FOR_0.8.5_NON_BLOCKING`. L'estrazione usa AnyDoc e ricorre ad
Apple Vision locale soltanto per le pagine PDF `needsOcr`.

### MedGemma

[![MedGemma: Gemma Terms](https://img.shields.io/badge/Hugging%20Face-MedGemma%20Gemma%20Terms-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/unsloth/medgemma-1.5-4b-it-GGUF)

MedGemma è un modello medico specialistico opzionale, non predefinito;
il suo uso segue i termini di licenza Gemma pubblicati nella model card.

---

<a id="redazione-e-riconoscimento-entità-cliniche"></a>

## Oscuramento dei dati identificativi e riconoscimento delle entità cliniche

### OpenMed

[![OpenMed: maziyarpanahi](https://img.shields.io/badge/GitHub-maziyarpanahi%2Fopenmed-181717?logo=github&logoColor=white)](https://github.com/maziyarpanahi/openmed)
[![openmed.life](https://img.shields.io/badge/openmed.life-0b7285)](https://openmed.life)

OpenMed è usato per de-identificazione e oscuramento dei dati identificativi
PII in un processo locale di supporto, dedicato a osservazione parallela
(shadow) e benchmark, non esposto al client. Il modello è
`OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1`.

### HUMADEX (italian_medical_ner)

[![HUMADEX: italian_medical_ner](https://img.shields.io/badge/Hugging%20Face-italian__medical__ner-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/HUMADEX/italian_medical_ner)

Il riconoscimento delle entità cliniche in italiano (NER) è candidato al
benchmark e non è stato promosso a runtime.

---

## Runtime e librerie locali

### Codice originale e notices distribuiti

Il codice originale di Ordito & Concilio, incluso il modulo locale
`@mediflow/web-auth-lifecycle-owner`, è coperto dalla [licenza MIT](./LICENSE)
del progetto. I builder canonici includono `LICENSE` e questa pagina nel
runtime standalone e nel runtime Headless; non modificano l’archivio o la
provenienza del modulo locale. La MIT non estende diritti sui materiali di terzi.

### Sharp e libvips

Il runtime macOS arm64 include `@img/sharp-libvips-darwin-arm64` 1.3.4,
con libvips 8.18.7 e le dipendenze elencate nel suo `versions.json`.
Il pacchetto dichiara `LGPL-3.0-or-later`; i
[notices upstream della stessa versione](https://github.com/lovell/sharp-libvips/blob/v1.3.4/THIRD-PARTY-NOTICES.md)
spiegano l’uso della LGPL v3 tramite la clausola “any later version” della LGPL
v2 o v2.1. La [fonte libvips 8.18.7](https://github.com/libvips/libvips/tree/v8.18.7)
e il [builder upstream 1.3.4](https://github.com/lovell/sharp-libvips/tree/v1.3.4)
restano distinti dal codice originale MediFlow.

Il README distribuito nel pacchetto conserva i notices upstream delle librerie
incluse. Il standalone aggiunge copie integrali dei testi ufficiali GNU
[LGPL v3](https://www.gnu.org/licenses/lgpl-3.0.html) e
[GPL v3](https://www.gnu.org/licenses/gpl-3.0.html), in
`licenses/sharp-libvips/`: la LGPL v3 incorpora i termini della GPL v3.
Queste copie colmano il buco dei testi LGPL/GPL nel payload; non qualificano
la conformità globale, i diritti di tutte le dipendenze o gli altri profili.

### Font Lume

**Inter Variable** dà forma alla Voce di Lume. Il file locale
`app/fonts/Inter-Variable-Latin.woff2` proviene da
[`@fontsource-variable/inter` 5.2.8](https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8),
che distribuisce il sottoinsieme latino di Inter v20. Il progetto di origine è
[rsms/inter](https://github.com/rsms/inter), con licenza
[SIL Open Font License 1.1](https://openfontlicense.org); la copia distribuita
con l'asset si trova in `app/fonts/Inter-OFL.txt`.

**IBM Plex Mono** costituisce il Registro di Lume. I file locali 400, 500 e
600 in `app/fonts/IBM-Plex-Mono-*-Latin.woff2` provengono da
[`@fontsource/ibm-plex-mono` 5.2.7](https://www.npmjs.com/package/@fontsource/ibm-plex-mono/v/5.2.7),
che distribuisce il sottoinsieme latino di IBM Plex Mono v20. Il progetto di
origine è [IBM/plex](https://github.com/IBM/plex), con licenza
[SIL Open Font License 1.1](https://openfontlicense.org); la copia distribuita
con gli asset si trova in `app/fonts/IBM-Plex-Mono-OFL.txt`.

### Ollama

[![Ollama](https://img.shields.io/badge/Ollama-runtime%20locale-000000?logo=ollama&logoColor=white)](https://ollama.com)

Ollama è un runtime locale opzionale per le funzioni AI ammesse: non gestisce
l'OCR della 0.8.5 e non interviene come alternativa generica quando un altro
percorso fallisce.

### MLX / MLX-LM

[![mlx-lm: MIT](https://img.shields.io/badge/GitHub-ml--explore%2Fmlx--lm%20MIT-181717?logo=github&logoColor=white)](https://github.com/ml-explore/mlx-lm)

MLX / MLX-LM esegue su Apple Silicon l'inferenza dei pesi ATHENA.

### Apple Vision

[![Apple Vision](https://img.shields.io/badge/Apple%20Vision-OCR%20macOS-555555?logo=apple&logoColor=white)](https://developer.apple.com/documentation/vision)

Apple Vision è il framework di sistema usato come passaggio OCR successivo
quando necessario, disponibile soltanto su macOS.

### OpenAI / Anthropic

L'attribuzione riguarda gli adapter provider v2 ufficiali e la prova
amministrativa della 0.8.5, soggetta a revisione e, come gli adapter,
`default OFF`. Le verifiche usano un trasporto simulato: non attestano
credenziali, rete reale, conservazione dei dati dell'account o disponibilità
operativa del cloud.

---

<a id="clinical-scales"></a>

## Scale cliniche: fonti, versioni e diritti

Fonti rilette l’11 ottobre 2026. Le fonti seguenti non costituiscono
approvazione clinica dell'implementazione né autorizzazione generale alla
riproduzione degli strumenti. La licenza del codice MediFlow non concede
diritti su scale, traduzioni o manuali di terzi. L’11 ottobre 2026 il titolare
del progetto ha attestato il possesso di tutte le autorizzazioni applicabili;
l’attestazione è registrata in WUL-723 e distinta dalla verifica documentale.
Gli accordi privati non sono stati esaminati e la revisione clinica resta aperta:
`lib/scales/scale-use-contract.ts` distingue l’attestazione dai riferimenti ai
permessi e dai revisori ancora non documentati.

| Strumento nel catalogo | Versione software dell’interpretazione (nuovi risultati) | Fonte e perimetro verificato | Decisione ancora necessaria |
| --- | --- | --- | --- |
| POMA-28 v1 | `mediflow.poma28.nonclassification.v1` | [NHS FPS 006 V1, luglio 2012](https://www.shropscommunityhealth.nhs.uk/content/doclib/10756.pdf), mappatura già documentata nell'[ADR 0118](./docs/adr/0118-tinetti-poma28-source-bound-submission.md). Identità, 16+12 punti e assenza di classificazione automatica restano invariati. | Identificare i metadati del permesso attestato per la resa italiana locale e l’uso elettronico; rivedere popolazione e contesto d’impiego. La resa non validata non è di per sé prova d'invalidità. |
| ADL locale | `mediflow.adl.local-interpretation.v2` | [HIGN, Katz, Try This n. 2](https://hign.org/sites/default/files/2020-06/Try_This_General_Assessment_2.pdf). Revisione 2019: ammette aiuto per scarpe e una parte del corpo nel bagno; le sue categorie non coincidono con le precedenti categorie locali. I nuovi risultati locali riportano solo il totale 0–6, con limiti di fonte, contesto e informante. | Identificare l'adattamento italiano adottato e i metadati del permesso attestato. Gli ancoraggi locali non vengono corretti né dichiarati equivalenti alla fonte. Le categorie di gravità locali non verificate non sono più attribuite ai nuovi risultati. |
| IADL locale | `mediflow.iadl.local-interpretation.v2` | [HIGN, Lawton, Try This n. 23, rev. 2019](https://hign.org/sites/default/files/2020-06/Try_This_General_Assessment_23.pdf). Otto domini per entrambi i sessi; totale locale 0–8. Attività mai svolte e contesto istituzionale limitano l’interpretazione; nessuna imputazione o riduzione automatica del denominatore. | Identificare la versione italiana, gli ancoraggi semplificati e i metadati del permesso attestato. Il riferimento esclude l'uso negli anziani istituzionalizzati; l'applicabilità locale richiede revisione. Gli ancoraggi locali semplificati non dimostrano equivalenza alla fonte. |
| MMSE locale | `mediflow.mmse.screening-limits.v2` | [PAR MMSE](https://www.parinc.com/products/MMSE) e [indicazioni PAR sui permessi](https://www.parinc.com/about/connect-with-us/licensing-team). Definizione locale: edizione e traduzione effettivamente implementate non sono identificate. [Foderaro 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9018649/) e [correzione 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11470845/) riguardano un testo specifico: le loro norme non sono adottate. Rimane un totale grezzo 0–30, senza correzioni normative. | Identificare edizione e traduzione concreta e documentare i metadati dell’autorizzazione attestata. Non sono stati esaminati accordi, ambiti o scadenze; non si inferisce una violazione. |
| GDS-15 locale | `mediflow.gds15.screening-limits.v2` | [Pagina dell'autore Yesavage](https://web.stanford.edu/~yesavage/GDS): screening, originale nel pubblico dominio e traduzioni distinte. [Chiesi 2018](https://doi.org/10.1016/j.jad.2017.11.045) riguarda una versione italiana, non approva quella locale; [meta-analisi 2024](https://www.nature.com/articles/s41598-024-68496-3): screening non equivale a diagnosi. Il totale locale 0–15 non attribuisce gravità; comprensione e attendibilità richiedono cautela nella compromissione cognitiva grave, non esclusione automatica per ogni deficit cognitivo. | Identificare fonte della traduzione italiana, periodo di riferimento tuttora non definito per il testo locale, corrispondenza degli item e metadati del permesso attestato. Il pubblico dominio dell'originale non approva la versione locale. |

Le versioni software identificano le formulazioni implementate, non un’edizione
validata dello strumento o un permesso. ADL, IADL, MMSE e GDS sono dichiarate
definizioni locali: per i soli nuovi risultati si esplicitano i limiti e si
aggiornano le versioni dell’interpretazione. POMA conserva testo interpretativo,
fonte e identità dello strumento; la descrizione ribadisce l’osservazione clinica.
Item, ancoraggi, risposte e calcoli non cambiano. Le regole di calcolo e il rifiuto
delle risposte incomplete senza imputazione restano nel registro esistente.
Non sono introdotte norme, soglie diagnostiche o formule di correzione.

Le condizioni HIGN riguardano la riproduzione del materiale completo per scopi
educativi senza fini di lucro, con attribuzione; i materiali mantengono il
copyright della Gerontological Society of America. Non si presume che questo
permesso copra l'adattamento e la distribuzione di MediFlow.

MMSE e GDS mantengono risultati grezzi di screening, non diagnosi o gravità.
Per MMSE il principio di non esclusione è coerente con
[NICE NG97, 1.2.4](https://www.nice.org.uk/guidance/ng97/chapter/recommendations),
confermato nell’estratto ufficiale indicizzato; il recupero della pagina completa
ha restituito 403. Non si applicano le norme di Foderaro a un testo locale diverso;
la correzione pubblicata nel 2024 va considerata insieme allo studio originale.
Per GDS non si presume un periodo di richiamo non identificato nella versione locale.

`interpretationVersion` è distinto da `instrument`: compare nei metadati e nel
testo dei nuovi risultati Web e Swift. Storico e report leggono il testo
registrato, senza ricalcolare le risposte. La versione registrata compare nelle
proiezioni di storico/stampa; FHIR la conserva nella nota testuale. Patient
Insight include l'identificatore registrato entro il budget esistente, ma la
sua selezione di estratti non promette l'intero testo della valutazione.
Versione assente non significa versione corrente. Le registrazioni precedenti,
comprese quelle POMA, non vengono migrate o rinominate; l’identità dello strumento
POMA resta separata dalla nuova versione software dell’interpretazione.

L’attestazione del titolare non equivale alla revisione clinica delle formulazioni
né identifica da sola edizioni, traduzioni, ambiti o scadenze. Il registro non è
un blocco runtime: `hold-proposed-not-enforced` resta una proposta da risolvere
per applicabilità e versione concreta, non una dichiarazione di diritti ignoti
o una sospensione attiva. La decisione sul nuovo uso e l’accettazione di WUL-723
restano nel tracker. Servono metadati minimi dei permessi e la revisione clinica
qualificata; non pubblicare contratti privati. Review AI e test tecnici non
sostituiscono queste decisioni.

## Sviluppo assistito

Questi strumenti hanno assistito la scrittura del codice; non costituiscono
fonti del prodotto.

[![Codex: OpenAI](https://img.shields.io/badge/Codex-OpenAI-412991?logo=openai&logoColor=white)](https://openai.com/codex)
[![Claude Code: Anthropic](https://img.shields.io/badge/Claude%20Code-Anthropic-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Repo Prompt CE](https://img.shields.io/badge/contesto-Repo%20Prompt%20CE-2ea043)](https://github.com/repoprompt/repoprompt-ce)
[![CodexBar](https://img.shields.io/badge/uso-CodexBar-181717?logo=github&logoColor=white)](https://github.com/steipete/CodexBar)

Codex e Claude Code hanno contribuito alla progettazione, all'implementazione,
alla revisione e alla verifica. Lo sviluppo assistito ha usato le famiglie
OpenAI GPT-5.2, GPT-5.3 Codex/Spark, GPT-5.4/mini, GPT-5.5, GPT-5.6
Sol/Terra/Luna e GPT-6 Astra/Sol/Luna; per Anthropic, Opus 4.8, Fable 5, Sonnet 5 e,
in una quota esplorativa storica, Haiku 4.5.

La [dashboard pubblica](./docs/development-usage.md) mostra lo storico dei token
per provider e modello e una serie separata per l’effort registrato, con fonte,
data, copertura e limiti. Gli aggregati includono solo registrazioni associate
alle checkout verificate di MediFlow; altri progetti e attribuzioni incerte
sono esclusi. La copertura è parziale; i token non misurano costo o qualità.

- **[Repo Prompt CE](https://github.com/repoprompt/repoprompt-ce)** (Eric Provencher): context engineering open source, usato in alcune sessioni per preparare selezioni e diff per gli agenti.
- **[CodexBar](https://github.com/steipete/CodexBar)** (Peter Steinberger): visibilità locale sull'uso dei modelli e fonte del conteggio storico del README.
- **[steipete/agent-scripts](https://github.com/steipete/agent-scripts)** (MIT): parte del flusso di review deriva da qui.

L'uso dei modelli non trasferisce loro le decisioni: le proposte restano
materiale da verificare e decisioni, attribuzioni e responsabilità del
progetto rimangono umane.

---

## Riconoscimenti upstream

![Non integrati](https://img.shields.io/badge/stato-non%20integrati-6e7681)

**ToolUniverse** e **vLLM** appartengono all'ecosistema di strumenti biomedici
e di serving a monte di ATHENA. Sono riconosciuti per questo ruolo, ma non
sono integrati nel data plane di MediFlow.

<div align="center">

---

_by Ordito & Concilio_

</div>
