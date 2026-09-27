# Sviluppo assistito: disclosure e consumi

MediFlow è sviluppato con l’assistenza di modelli AI. Codex e Claude Code
hanno contribuito a progettazione, scrittura, revisione e verifica dei sorgenti.
Direzione e responsabilità del progetto rimangono dell’autore. I controlli
automatizzati non equivalgono a una revisione umana di ogni modifica. L’uso di
questi strumenti durante lo sviluppo non attiva servizi AI nel gestionale e
non dimostra qualità o validazione clinica.

Questa pagina rende pubblici gli aggregati disponibili e il modo in cui sono
letti. Le istruzioni personali usate dagli assistenti per sviluppare restano
fuori dalla repository. I [crediti](../CREDITS.md#sviluppo-assistito) riconoscono
gli strumenti impiegati.

![Storico dei token per provider, modello ed effort registrato; serie e limiti spiegati nelle tabelle seguenti](../screenshots/token-models.svg)

## Come leggere il grafico

- **Perimetro:** tutti i progetti locali rilevati, senza filtro MediFlow.
  Nessuna attribuzione esclusiva a questa applicazione, release, PR o commit.
- **Token:** contesto elaborato, con la cache inclusa. Non sono una misura di
  spesa, quota dell’abbonamento, codice prodotto o qualità. Il testo riutilizzato
  può essere conteggiato a ogni elaborazione: non sono parole uniche.
- **Provider:** dedotto dall’identificatore registrato: `gpt-*` e
  `codex-auto-review` → OpenAI; `claude-*` → Anthropic. Gli altri restano
  “Non determinato”. Questa classificazione non verifica endpoint, fatturazione
  o sede di esecuzione. Gli alias, come `gpt-reserve` o `chatgpt-web/*`,
  non identificano necessariamente il modello effettivamente eseguito.
- **Ambiente:** Codex e Claude Code indicano chi registra il consumo, non il
  provider del modello. I record OpenAI dentro Claude Code rimangono in
  quell’ambiente ma sono classificati OpenAI nel grafico per provider.
- **Effort:** livello di ragionamento registrato nel contesto della risposta,
  non una misura dello sforzo realmente impiegato o della qualità. `none`
  sarebbe un valore registrato; “Non registrato” indica invece un dato mancante.
  I livelli di modelli diversi non sono prestazioni equivalenti.

## Fonti, copertura e limiti

Lo storico principale proviene dagli aggregati locali di **CodexBar 0.60.3**,
raccolti il **27 settembre 2026** con una finestra richiesta di 365 giorni.
Sono conservate le date giornaliere restituite dalla fonte; il grafico le
raggruppa per mese. Le somme giornaliere e per modello riconciliano con i totali
di ciascun ambiente. Una somma riconciliata non dimostra completezza storica.
CodexBar dichiara copertura stabilita per Claude Code, ma non per Codex in
questo snapshot. Giorni senza record non provano assenza di attività.
Non è attestata l’esclusività contabile tra ambienti che possono delegare
lavoro l’uno all’altro: il totale descrive registrazioni, non consumo fatturato.

CodexBar non espone l’effort nei suoi aggregati. Il terzo grafico usa perciò
una **serie distinta e parziale**: soltanto record individuali di utilizzo
Codex, deduplicati per identificatore di risposta, appartenenti alla rispettiva
chat e associati al contesto dello stesso turno disponibile prima della risposta.
La raccolta si ferma all’istante dello snapshot CodexBar di Codex. Somma input e output; non
aggiunge di nuovo cache o reasoning già inclusi. Le date sono in Europe/Rome.
Non usa contatori cumulativi né distribuisce proporzionalmente token a un effort.
Il numero di file indicizzati ma mancanti è riportato sotto. Eventuali metadati
di modello/effort mancanti restano sconosciuti.

**La serie effort non va sommata ai totali CodexBar, né usata per suddividerli.**
Copertura e metodo sono diversi; non viene ricostruito un effort per Claude
Code o per il resto dello storico. I vecchi snapshot pubblicati nella storia
Git restano fotografie delle rispettive fonti: cambiamenti di copertura o
contabilità possono cambiare i totali, anche senza nuovi consumi.

## Riproducibilità e riservatezza

Il [dataset pubblico](./data/development-usage.json) contiene solo date,
ambiente, provider dedotto, identificatore modello, effort registrato e conteggi,
oltre ai metadati aggregati della fonte. Non contiene prompt, messaggi, titoli,
identificatori di chat, percorsi locali, credenziali o dati clinici.
La raccolta dei log e la preparazione degli aggregati restano locali.

Il generatore incluso nella repository legge esclusivamente questo dataset,
senza cercare sessioni personali né chiamare servizi esterni:

```bash
npm run build:usage-dashboard
npm run check:usage-dashboard
```

Il primo comando rigenera SVG e tabelle; il secondo controlla che corrispondano
al dataset. La CI esegue questo controllo e le sue prove sintetiche a ogni PR.
La validazione rifiuta campi extra, duplicati, somme incoerenti e
nuovi identificatori di modello non ancora riesaminati. Per aggiornare i dati,
pubblicare un nuovo snapshot aggregato con data, fonte e copertura esplicite.

## Conteggi esatti

<!-- usage-dashboard:start -->

Snapshot: **2026-09-27**. Token storici CodexBar: **52.803.406.448**.

| Ambiente che registra | Periodo disponibile | Token | Cache letta (inclusa) | Copertura attestata dalla fonte |
| :-- | :-- | --: | --: | :-- |
| Codex | 2026-02-01 → 2026-09-27 | 46.765.853.693 | 44.875.987.911 | No: completezza sconosciuta |
| Claude Code | 2026-04-20 → 2026-08-10 | 6.037.552.755 | 5.688.595.814 | Sì, per i log disponibili |

### Storico mensile per provider

| Provider dedotto | 2026-02 | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 | 2026-09 | Totale |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| OpenAI | 421.987.651 | 1.379.921.643 | 2.016.766.048 | 2.019.064.765 | 1.082.577.444 | 9.310.773.452 | 19.314.534.554 | 11.743.249.256 | 47.288.874.813 |
| Anthropic | 0 | 0 | 248.350.589 | 1.071.430.483 | 702.390.984 | 2.123.780.897 | 1.361.133.247 | 0 | 5.507.086.200 |
| Non determinato | 0 | 0 | 0 | 0 | 7.396.835 | 48.600 | 0 | 0 | 7.445.435 |

### Storico mensile completo per modello

Valori zero indicano assenza di token registrati, non prova di mancato utilizzo. L’ultimo mese è parziale.

| Identificatore modello | 2026-02 | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 | 2026-09 | Totale |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| gpt-5.6-sol | 0 | 0 | 0 | 0 | 0 | 7.676.784.142 | 12.439.694.396 | 5.498.150.637 | 25.614.629.175 |
| gpt-5.6-luna | 0 | 0 | 0 | 0 | 0 | 52.983.756 | 4.803.946.552 | 314.841.668 | 5.171.771.976 |
| gpt-5.5 | 0 | 0 | 298.688.839 | 2.017.076.913 | 1.082.010.226 | 730.752.134 | 301.511 | 0 | 4.128.829.623 |
| gpt-6-astra | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3.793.898.988 | 3.793.898.988 |
| gpt-5.6-terra | 0 | 0 | 0 | 0 | 0 | 837.488.432 | 1.931.863.022 | 437.555.101 | 3.206.906.555 |
| gpt-5.4 | 0 | 1.307.797.888 | 1.708.550.233 | 608.426 | 452.895 | 0 | 0 | 0 | 3.017.409.442 |
| claude-opus-5 | 0 | 0 | 0 | 0 | 0 | 1.136.242.413 | 1.041.246.122 | 0 | 2.177.488.535 |
| claude-opus-4-7 | 0 | 0 | 248.350.589 | 1.071.430.483 | 22.874.283 | 0 | 0 | 0 | 1.342.655.355 |
| gpt-6-sol | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.274.544.190 | 1.274.544.190 |
| claude-fable-5 | 0 | 0 | 0 | 0 | 227.603 | 814.267.257 | 180.188.753 | 0 | 994.683.613 |
| claude-opus-4-8 | 0 | 0 | 0 | 0 | 675.856.891 | 81.510.241 | 359.873 | 0 | 757.727.005 |
| gpt-5.3-codex | 320.831.100 | 53.521.532 | 9.526.976 | 175.805 | 0 | 0 | 0 | 0 | 384.055.413 |
| gpt-6-luna | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 334.863.534 | 334.863.534 |
| claude-sonnet-5 | 0 | 0 | 0 | 0 | 0 | 91.760.986 | 139.338.499 | 0 | 231.099.485 |
| gpt-daybreak-blue-latest | 0 | 0 | 0 | 0 | 0 | 0 | 137.204.411 | 80.375.788 | 217.580.199 |
| gpt-5.2-codex | 87.674.431 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 87.674.431 |
| gpt-5.3-codex-spark | 2.589.995 | 18.602.223 | 0 | 0 | 114.323 | 0 | 1.524.662 | 9.019.350 | 31.850.553 |
| codex-auto-review | 0 | 0 | 0 | 0 | 0 | 12.764.988 | 0 | 0 | 12.764.988 |
| gpt-5.2 | 10.892.125 | 0 | 0 | 1.203.621 | 0 | 0 | 0 | 0 | 12.095.746 |
| qwen3coder30:latest | 0 | 0 | 0 | 0 | 6.220.242 | 0 | 0 | 0 | 6.220.242 |
| claude-haiku-4-5 | 0 | 0 | 0 | 0 | 3.432.207 | 0 | 0 | 0 | 3.432.207 |
| qwen3-coder:30b-a3b-q4 | 0 | 0 | 0 | 0 | 792.435 | 0 | 0 | 0 | 792.435 |
| qwen3.6:35b-a3b | 0 | 0 | 0 | 0 | 359.964 | 0 | 0 | 0 | 359.964 |
| devstral-gguf | 0 | 0 | 0 | 0 | 0 | 44.008 | 0 | 0 | 44.008 |
| qwen25-coder:14b-q4 | 0 | 0 | 0 | 0 | 24.194 | 0 | 0 | 0 | 24.194 |
| qwen36-mlx | 0 | 0 | 0 | 0 | 0 | 4.592 | 0 | 0 | 4.592 |

### Provider, modello ed effort registrato

Serie separata: **2026-09-03 → 2026-09-27**, **10.399.417.712 token** in **77.960 risposte**. 275 file indicizzati non erano disponibili: la copertura non è completa.

| Provider dedotto | Identificatore modello | Effort registrato | Token |
| :-- | :-- | :-- | --: |
| OpenAI | gpt-6-astra | ultra | 2.231.841.866 |
| OpenAI | gpt-5.6-sol | medium | 1.648.265.213 |
| OpenAI | gpt-6-sol | medium | 1.205.426.848 |
| OpenAI | gpt-5.6-sol | ultra | 982.521.161 |
| OpenAI | gpt-6-astra | medium | 847.281.125 |
| OpenAI | gpt-6-astra | low | 554.621.220 |
| OpenAI | gpt-6-astra | max | 553.186.446 |
| OpenAI | gpt-5.6-terra | medium | 439.849.899 |
| OpenAI | gpt-6-astra | xhigh | 390.261.269 |
| OpenAI | gpt-5.6-luna | max | 261.017.691 |
| OpenAI | gpt-5.6-sol | xhigh | 259.461.299 |
| OpenAI | gpt-6-luna | max | 210.118.760 |
| Non determinato | chatgpt-web/pro | ultra | 193.800.228 |
| OpenAI | gpt-6-luna | medium | 136.244.254 |
| OpenAI | gpt-daybreak-blue-latest | xhigh | 91.477.948 |
| OpenAI | gpt-5.6-sol | low | 66.404.827 |
| OpenAI | gpt-6-sol | low | 44.891.814 |
| OpenAI | gpt-5.6-sol | high | 43.041.783 |
| OpenAI | gpt-6-astra | high | 41.792.152 |
| Non determinato | chatgpt-web/extra-high | xhigh | 40.996.734 |
| OpenAI | gpt-6-sol | high | 40.744.129 |
| OpenAI | gpt-5.6-luna | medium | 40.292.777 |
| OpenAI | gpt-daybreak-blue-latest | medium | 26.532.452 |
| OpenAI | codex-auto-review | low | 12.565.489 |
| OpenAI | gpt-6-sol | xhigh | 11.427.420 |
| OpenAI | gpt-5.6-terra | low | 7.070.910 |
| OpenAI | gpt-reserve | ultra | 4.858.982 |
| Non determinato | chatgpt-web/high | high | 4.347.634 |
| Non determinato | chatgpt-web/pro | max | 3.757.937 |
| OpenAI | gpt-6-luna | high | 3.016.568 |
| Non determinato | unknown | Non registrato | 2.114.317 |
| OpenAI | gpt-5.3-codex-spark | medium | 186.560 |

<!-- usage-dashboard:end -->
