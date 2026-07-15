<div align="center">

# Crediti e attribuzioni

**MediFlow è software originale.** Poggia però su idee, modelli e strumenti di
altri, e li dichiara in chiaro: qui trovi ogni fonte di ispirazione, ogni modello,
ogni libreria e runtime, con il ruolo che ha nel progetto, il link e la licenza.

Dove la relazione è _ispirazione_, il codice di MediFlow è una implementazione
originale: nessun asset, codice o dato di terzi è incluso, salvo dove indicato.

</div>

---

## Ispirazione

Idee da cui è derivata una forma o un metodo, senza importarne il codice.

### Kree8: il look

![Ispirazione](https://img.shields.io/badge/relazione-ispirazione-8957e5)
[![kree8.studio](https://img.shields.io/badge/kree8.studio-111111)](https://www.kree8.studio/)

Il look e la grammatica visiva del cockpit clinico (root web, palette, ritmo,
movimento) sono **derivati da Kree8**, come ispirazione esterna. Nessun asset o
codice di Kree8 è incluso: l'implementazione clinica e il modello di interazione
sono originali di MediFlow.

### ClinSeek: il metodo di benchmark

![Ispirazione](https://img.shields.io/badge/relazione-ispirazione-8957e5)
![Non importato](https://img.shields.io/badge/codice-non%20importato-6e7681)

Il pattern "prima cerca le fonti, poi sintetizza" ha ispirato un probe di
benchmark sintetico di assorbimento evidenza. Nessun codice ClinSeek, nessun
dato MIMIC e nessun modello ClinSeek è incluso nel runtime.

---

## Motore di registrazione della visita

Riferimenti per la dettatura fluida e il post-processing della visita. Definiscono
un confine di prodotto: nessun runtime o audio è integrato.

### Fluid

[![FluidVoice: GPLv3](https://img.shields.io/badge/FluidVoice-GPLv3-a42e2b?logo=gnu&logoColor=white)](https://github.com/altic-dev/FluidVoice)
[![FluidAudio: Apache 2.0](https://img.shields.io/badge/FluidAudio-Apache%202.0-1f6feb?logo=swift&logoColor=white)](https://github.com/FluidInference/FluidAudio)
![Fluid Intelligence: privato](https://img.shields.io/badge/Fluid%20Intelligence-privato-6e7681)

FluidVoice (dettatura macOS, GPLv3), FluidAudio (SDK Swift audio on-device,
Apache 2.0) e Fluid Intelligence (post-processing privato, non integrato).

---

## Modelli AI usati localmente

Modelli eseguiti sul dispositivo, senza egress di default.

### ATHENA (ATHENA-R1-Qwen3-8B)

[![arXiv 2606.28692](https://img.shields.io/badge/arXiv-2606.28692-b31b1b?logo=arxiv&logoColor=white)](https://arxiv.org/abs/2606.28692)
[![mims-harvard/ATHENA: MIT](https://img.shields.io/badge/GitHub-mims--harvard%2FATHENA-181717?logo=github&logoColor=white)](https://github.com/mims-harvard/ATHENA)
[![Model: MIT](https://img.shields.io/badge/Hugging%20Face-ATHENA--R1--Qwen3--8B-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/mims-harvard/ATHENA-R1-Qwen3-8B)

Modello di ragionamento terapeutico. MediFlow ne usa i pesi locali via MLX per
una bozza review-only (lane `mediflow.treatment_reasoning.v1`) e ne adotta il
pattern di report (recommendation, evidence, reasoning, caveats, trace).
ToolUniverse e vLLM upstream non sono integrati. Lineage: Qwen3-8B.

### Qwen3

[![Qwen3-8B: Apache 2.0](https://img.shields.io/badge/Hugging%20Face-Qwen3--8B%20Apache%202.0-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/Qwen/Qwen3-8B)

Famiglia text-only usata come default locale e base di ATHENA.

### DeepSeek

[![deepseek-ocr](https://img.shields.io/badge/deepseek--ocr-via%20Ollama-4d6bfe)](https://ollama.com/library/deepseek-ocr)

OCR locale primario, eseguito tramite Ollama.

### MedGemma

[![MedGemma: Gemma Terms](https://img.shields.io/badge/Hugging%20Face-MedGemma%20Gemma%20Terms-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/unsloth/medgemma-1.5-4b-it-GGUF)

Modello specialistico medico opzionale, non di default. Usato secondo i termini
di licenza Gemma pubblicati sulla model card.

---

## Redazione e riconoscimento entità cliniche

### OpenMed

[![OpenMed: maziyarpanahi](https://img.shields.io/badge/GitHub-maziyarpanahi%2Fopenmed-181717?logo=github&logoColor=white)](https://github.com/maziyarpanahi/openmed)
[![openmed.life](https://img.shields.io/badge/openmed.life-0b7285)](https://openmed.life)

De-identificazione e redazione PII come sidecar locale di shadow e benchmark,
non client-facing. Modello: `OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1`.

### HUMADEX (italian_medical_ner)

[![HUMADEX: italian_medical_ner](https://img.shields.io/badge/Hugging%20Face-italian__medical__ner-ffcc00?logo=huggingface&logoColor=black)](https://huggingface.co/HUMADEX/italian_medical_ner)

NER clinico italiano, candidato di benchmark, non promosso a runtime.

---

## Runtime e librerie locali

### Font Lume

**Inter Variable** e la Voce di Lume. Il file locale
`app/fonts/Inter-Variable-Latin.woff2` proviene da
[`@fontsource-variable/inter` 5.2.8](https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8),
subset latino del font Inter v20. Upstream:
[rsms/inter](https://github.com/rsms/inter). Licenza:
[SIL Open Font License 1.1](https://openfontlicense.org). La licenza distribuita
con l'asset e in `app/fonts/Inter-OFL.txt`.

**IBM Plex Mono** e il Registro di Lume. I file locali 400, 500 e 600 in
`app/fonts/IBM-Plex-Mono-*-Latin.woff2` provengono da
[`@fontsource/ibm-plex-mono` 5.2.7](https://www.npmjs.com/package/@fontsource/ibm-plex-mono/v/5.2.7),
subset latino del font IBM Plex Mono v20. Upstream:
[IBM/plex](https://github.com/IBM/plex). Licenza:
[SIL Open Font License 1.1](https://openfontlicense.org). La licenza distribuita
con gli asset e in `app/fonts/IBM-Plex-Mono-OFL.txt`.

### Ollama

[![Ollama](https://img.shields.io/badge/Ollama-runtime%20locale-000000?logo=ollama&logoColor=white)](https://ollama.com)

Runtime locale per AI e OCR, opzionale.

### MLX / MLX-LM

[![mlx-lm: MIT](https://img.shields.io/badge/GitHub-ml--explore%2Fmlx--lm%20MIT-181717?logo=github&logoColor=white)](https://github.com/ml-explore/mlx-lm)

Inferenza su Apple Silicon, runtime dei pesi ATHENA.

### Apple Vision

[![Apple Vision](https://img.shields.io/badge/Apple%20Vision-OCR%20macOS-555555?logo=apple&logoColor=white)](https://developer.apple.com/documentation/vision)

Fallback OCR disponibile solo su macOS, framework di sistema Apple.

---

## Sviluppo assistito

Strumenti del processo di scrittura del codice, non fonti del prodotto.

[![Codex: OpenAI](https://img.shields.io/badge/Codex-OpenAI-412991?logo=openai&logoColor=white)](https://openai.com/codex)
[![Claude Code: Anthropic](https://img.shields.io/badge/Claude%20Code-Anthropic-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Repo Prompt CE](https://img.shields.io/badge/contesto-Repo%20Prompt%20CE-2ea043)](https://github.com/repoprompt/repoprompt-ce)
[![CodexBar](https://img.shields.io/badge/uso-CodexBar-181717?logo=github&logoColor=white)](https://github.com/steipete/CodexBar)

Codex e Claude Code hanno contribuito a progettazione, implementazione, review
e verifica. I modelli registrati nei log MediFlow comprendono le famiglie
OpenAI GPT-5.2, GPT-5.3 Codex/Spark, GPT-5.4/mini, GPT-5.5 e GPT-5.6
Sol/Terra/Luna; sul lato Anthropic, Opus 4.8, Fable 5, Sonnet 5 e una quota
esplorativa storica di Haiku 4.5.

Lo snapshot locale del 15 luglio 2026 conta circa 17,56 miliardi di token di
sessione: 11,33 miliardi con Codex e 6,22 con Claude Code. Circa 16,41 miliardi
sono input recuperato dalla cache; il dato misura soprattutto contesto riletto
nel lavoro assistito, non righe di codice, costo o qualità. Un conteggio
precedente basato su una metodologia diversa non è direttamente confrontabile.

- **[Repo Prompt CE](https://github.com/repoprompt/repoprompt-ce)** (Eric Provencher): context engineering open source, usato in alcune sessioni per preparare selezioni e diff per gli agenti.
- **[CodexBar](https://github.com/steipete/CodexBar)** (Peter Steinberger): visibilità locale sull'uso dei modelli e fonte del conteggio storico del README.
- **[steipete/agent-scripts](https://github.com/steipete/agent-scripts)** (MIT): parte del flusso di review deriva da qui.

Le proposte dei modelli sono materiale da verificare. Decisioni, attribuzioni e
responsabilità del progetto restano umane.

---

## Riconoscimenti upstream

![Non integrati](https://img.shields.io/badge/stato-non%20integrati-6e7681)

**ToolUniverse** e **vLLM**: ecosistema di tool biomedici e serving a monte di
ATHENA, citati come riconoscimento e non integrati nel data plane di MediFlow.

<div align="center">

---

_by Ordito & Concilio_

</div>
