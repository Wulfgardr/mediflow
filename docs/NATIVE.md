# Sviluppo Nativo (macOS)

> Guida tecnica del client SwiftUI di MediFlow.

> [!IMPORTANT]
> Dopo `v0.4.0` il filone macOS/parity e **congelato**: la shell nativa entra in **riscrittura controllata** ("demolizione controllata").
> Questo documento resta canonico per capire lo snapshot esistente, il contratto `/api/v1`, il trasporto TLS locale e i vincoli security da preservare nel rebuild.
> La direzione Apple, pero, e oggi piu ampia: macOS resta il nodo di partenza, mentre iPadOS/iOS rientrano nello stesso disegno `home-base + paired client` descritto nei documenti canonici.

Riferimenti correlati:

- [docs/README.md](./README.md) (mappa canonica documentazione)
- [docs/markdown-index.md](./markdown-index.md) (indice completo markdown)
- [docs/walkthrough.md](./walkthrough.md) (flusso end-to-end)
- [docs/local-api-tls.md](./local-api-tls.md) (trasporto TLS locale)
- [docs/native-testing.md](./native-testing.md) (strategia test ufficiale)

---

## Stato del progetto

Il client nativo documentato qui non e piu la base per nuova delivery incrementale. Oggi va letto cosi:

* **Snapshot operativo esistente**: il vecchio client ha gia superato il read-only e contiene CRUD clinico essenziale, tooling AI locale e lock screen con PIN.
* **Contratto da preservare**: `/api/v1`, bootstrap secure-first del token locale, TLS proxy e policy di sicurezza restano validi e non vanno persi.
* **Nuovo mandato**: le prossime feature macOS non si stratificano su questo shell; il lavoro passa a un rebuild controllato da zero.
* **Direzione multi-device**: l'estensione a iPadOS/iOS non passa da un database remoto condiviso, ma dallo stesso boundary locale/API che oggi regge il filone `home-base`.
* **Entrypoint compilato corrente**: `MediFlowMacApp` apre la shell
  Apple/home-base come finestra primaria. Il prototipo oncologico resta
  apribile come finestra separata e non va confuso con MediFlow prodotto o con
  OncoBackboneMac, che e un'applicazione distinta usabile solo come riferimento
  visuale esterno.

Lo snapshot corrente supporta comunque:

* **CRUD clinico essenziale**: creazione pazienti, visite, terapie e controlli.
  Le terapie native usano lo stesso contratto `/api/v1` della web UI per
  farmaco AIFA/manuale, AIC/ATC, principio attivo, posologia, motivazione,
  indicazione ICD/sentinella, date e stato.
  I controlli/appuntamenti nativi mantengono parita sul contratto condiviso
  per data, titolo, note operative, stato, source manuale e metadata di
  versione restituita dal backend.
* **AI Control Panel**: monitoraggio modelli e chat tecnica locale.
* **Sicurezza**: lock screen con PIN, cifratura in memoria e certificate pinning.

---

## Requisiti e setup rapido

1. **Xcode 15+** (Swift 5.9).
2. **Node.js 20+**.
3. **Mkcert** (per HTTPS locale).

### Quick start

**Opzione A: launcher rapido**

```bash
./scripts/Launch_MediFlowMac.command
```

* configura TLS locale
* compila il client nativo
* apre la app macOS
* registra `runtime-status.json` accanto a `native-config.json`, cosi il
  pannello runtime nella app puo mostrare lo stato del bootstrap senza esporre
  token o contenuti sensibili

**Opzione B: setup sviluppatore**

1. Prepara l'ambiente:

    ```bash
    ./scripts/native-setup.sh
    ```

    *(Genera certificati, config e controlla le porte.)*

2. Apri il progetto in Xcode:

    ```bash
    open native/MediFlowMac/Package.swift
    ```

---

## Testing nativo (Xcode-first)

La strategia testing ufficiale e documentata in:

- [docs/native-testing.md](./native-testing.md)
- [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md)
- [docs/parity-smoke.md](./parity-smoke.md)
- [docs/parity-click-map-macos.md](./parity-click-map-macos.md)

Comandi rapidi:

```bash
npm run test:native
npm run test:native:xcode
npm run test:parity:smoke
```

Nel percorso mobile paired corrente, il target condiviso include anche una cache
locale derivata della lista pazienti: lo snapshot e cifrato con chiave locale da
Portachiavi, e valido solo per il medesimo `home-base` / ambulatorio entro una
soglia breve. Quando il Mac non e raggiungibile, l'app mobile puo mostrare lo
stato `offline degradato` in sola consultazione; non esistono ancora scritture
offline o coda di merge mobile.

Le prime scritture mobile paired esposte nella shell condivisa coprono diario
clinico e terapie. Dalla scheda paziente iPhone/iPad si possono leggere le
ultime voci diario, inviare una nuova voce online all'home-base, modificarla e
annullarla con soft-delete reviewable. Le terapie espongono list/create/update e
annullamento online per campi manuali non-AI essenziali: farmaco, principio
attivo opzionale, posologia, stato, date e motivazione. Ogni create diario usa
un identificativo client-side stabile per evitare duplicati se la rete cade dopo
il commit; update e annullamento usano la `version` del record e mostrano il
conflitto come richiesta di ricarica/confronto. Non esistono prescrizione SISS
nativa, catalogo farmaci mobile, scritture offline o coda di merge. Controlli e
osservazioni restano da estendere nello stesso boundary `/api/v1/network/*`.

---

## Funzionalità principali

### 0. Shell Apple/home-base e runtime locale

La finestra primaria della app macOS e il shell Apple/home-base condiviso con
la family architecture. In questa slice il bundle **osserva** il runtime locale:

* legge `~/Library/Application Support/MediFlow/native-config.json`;
* legge `runtime-status.json` prodotto da `scripts/native-setup.sh`;
* mostra server, modalita rete, presenza token, PID proxy e coerenza del
  fingerprint TLS;
* include nel bundle il runtime Next standalone validato da
  `check:standalone-runtime-bundle`;
* puo avviare e arrestare esplicitamente il backend web production locale;
* puo avviare e arrestare esplicitamente il solo proxy TLS locale usando lo
  script `local-api-tls-proxy.mjs` incluso nel bundle;
* arresta backend/proxy con timeout esplicito e escalation locale quando il
  processo non termina in modo ordinato;
* mostra lo stato diagnostico read-only di Ollama (`127.0.0.1:11434`) e
  Docker/ICD (`127.0.0.1:8888`) quando sono gia attivi;
* non mostra mai token, certificati, chiavi o dati paziente;
* non installa, avvia, arresta o supervisiona Ollama o container Docker.

`scripts/build-native-app.sh` produce un bundle locale non firmato per default,
ma puo firmarlo con `MEDIFLOW_CODESIGN_IDENTITY` (`-` per ad-hoc, Developer ID
per distribuzione) e puo inviare un archivio a notarizzazione con
`MEDIFLOW_NOTARY_PROFILE`. I servizi opzionali sono visibili come health
diagnostico, non come processi app-managed.

### 1. Lock Screen & Sicurezza

L'app parte bloccata:

* Devi inserire il **PIN** (lo stesso della web app).
* Il PIN deriva la **Master Key** in RAM.
* Se l'app va in background (o il Mac si sospende), la chiave viene scaricata.

### 2. AI Control Panel & Tools

Nel tab `Strumenti` trovi il pannello AI.

* **Stato Modelli**: Vedi se Qwen/DeepSeek sono carichi in memoria.
* **Chat tecnica**: puoi testare prompt o fare troubleshooting locale.
* **Gestione Farmaci/ICD**: Strumenti rapidi per cercare codici senza aprire un paziente.
* **Cataloghi in Settings**: il pannello `Cataloghi` espone stato/count,
  import JSON e svuotamento controllato per farmaci ed esenzioni usando il
  backend condiviso, senza storage nativo duplicato.

### 3. Editor Full-Feature

I form di inserimento (Nuovo Paziente, Nuova Visita) sono nativi SwiftUI.

* Usa i componenti di sistema (Date Picker, Menu).
* Performance e interazione sono più immediate rispetto al browser.

---

## Architettura client-server

Il client Swift comunica con Next.js tramite bridge TLS locale.

* **Server**: `https://localhost:3443` (proxy verso `:3000`)
* **API**: `/api/v1/*`
* **Auth**: Bearer token + sessione PIN

```mermaid
graph LR
    Swift[📱 App SwiftUI] -->|HTTPS + Pinning| Proxy[🔒 TLS Proxy :3443]
    Proxy -->|HTTP| Next[⚙️ Next.js :3000]
    Next --> DB[(SQLite)]
```

### Struttura codice (`native/MediFlowMac`)

* `Services/LocalAPIClient.swift`: comunicazione HTTP/TLS con pinning.
* `Services/SecuritySession.swift`: ciclo di vita chiavi in memoria.
* `Views/AIControlPanelView.swift`: controllo runtime AI locale.

---

## Come contribuire

Se vuoi aggiungere una vista:

1. Controlla `lib/api/v1/types.ts` per vedere i dati.
2. Crea la View in SwiftUI dentro `Views/`.
3. Ricordati di usare `SecuritySession.shared.decrypt(...)` quando mostri dati sensibili!
