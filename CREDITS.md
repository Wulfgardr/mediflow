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
Sol/Terra/Luna e GPT-6 Astra; per Anthropic, Opus 4.8, Fable 5, Sonnet 5 e,
in una quota esplorativa storica, Haiku 4.5.

La rilevazione locale del 5 settembre 2026, prodotta da CodexBar 0.56.4,
copre il periodo dal 1 febbraio al 5 settembre 2026 e conta
**50.810.826.389 token di sessione**: 44.773.273.634 registrati da Codex e
6.037.552.755 da Claude Code. Di questi, 48.607.240.570 token (95,7%)
riguardano cache letta.

Poiché **non sono filtrati per repository**, questi aggregati non misurano
i token impiegati esclusivamente per MediFlow o per la 0.8.5, né attestano
la completezza storica di Codex. Descrivono il contesto elaborato, non righe
di codice, costo o qualità: per la stessa ragione, conteggi con coperture
diverse non sono direttamente confrontabili.
[Dashboard e metodo](./README.md#sviluppo-assistito).

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
