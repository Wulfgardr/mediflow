# Architettura MediFlow (Deep Dive)

> [!NOTE]
> **Stato documento: SECONDARY (deep dive tecnico).**
> Per i confini stabili prevale [ARCHITECTURE.md](../ARCHITECTURE.md).
> Per il flusso operativo reale prevale [docs/walkthrough.md](./walkthrough.md).

Questo file serve a dare una lettura più discorsiva del sistema reale, senza
sovrapporsi ai documenti canonici.

---

## 1. Snapshot tecnico attuale

MediFlow oggi va letto così:

- **web app locale** come superficie primaria;
- **SQLite cifrato** come storage autorevole;
- **`/api/v1`** come contratto condiviso per i client Apple;
- **`home-base` read-only-first** con write limitati/versionati su
  profilo/status paziente, diario clinico, terapie, checkup e osservazioni;
- **document intelligence reviewable** con artifact `parse/evidence`;
- **stack AI locale governato** e separato dalle lane `benchmark-only`;
- **SISS/FSE** dentro un boundary esplicito di handoff e `webapp-assisted`.

### Topologia logica

```mermaid
flowchart TD
    subgraph "Interfaccia"
        Web["Web app Next.js"]
        Mac["Shell macOS esistente"]
        Peer["Client paired iPhone/iPad/macOS"]
    end

    subgraph "Core locale"
        TLS["TLS Proxy :3443"]
        Next["Next.js :3000"]
        DB[("SQLite medical.db")]
    end

    subgraph "Servizi locali"
        Ollama["Ollama :11434"]
        ICD["ICD-11 Docker :8888"]
        OpenMed["OpenMed redaction :18080"]
    end

    Web --> Next
    Mac --> TLS --> Next
    Peer --> TLS
    Next --> DB
    Next --> Ollama
    Next --> ICD
    Next --> OpenMed
```

La cosa importante è questa: i client non parlano con un database remoto.
Parlano con un **nodo locale** che resta autorevole e che, quando serve, espone
solo un perimetro documentato.

---

## 2. Dato, chiavi e persistenza

Il dato clinico sensibile viene cifrato lato client prima della persistenza.

Schema essenziale:

1. l'utente sblocca con il PIN;
2. il PIN deriva la KEK;
3. la KEK sblocca la master key in RAM;
4. i campi clinici vengono cifrati in `AES-256-GCM`;
5. su disco finiscono valori nel formato `ENC:<iv_b64>:<cipher_b64>`.

Questo vale sia per il dato strutturato sia per gli snapshot documentali
sensibili, compresi `summarySnapshot` e `parseEvidenceArtifactSnapshot`.

---

## 3. API e boundary operativi

Le superfici principali sono tre:

| Surface | Auth | Ruolo |
| --- | --- | --- |
| `/api/*` | sessione web | CRUD web e overview locale |
| `/api/v1/*` | bearer token locale | contratto condiviso per client Apple |
| `/api/v1/network/*` | paired client + sessione operatore | perimetro `home-base`, read-only-first con primi write limitati paziente/diario/terapie/checkup/osservazioni versionati |

Punti da non perdere:

- `local-only` resta il default;
- `home-base` è opt-in;
- il pairing è esplicito;
- non esistono ancora write remoti o sync automatici;
- i client iPadOS/iOS rientrano in questo stesso disegno, non in una scorciatoia tipo “DB remoto”.

---

## 4. Document intelligence e AI

La pipeline documentale non è più solo “upload e riassunto”.

Oggi la direzione è:

1. normalizzazione input;
2. OCR locale;
3. estrazione/sintesi locale;
4. persistenza di artifact cifrati sul singolo allegato;
5. consumer reviewable su `Patient Insight`, smart import e create-flow documentale.

Lato governance, MediFlow tiene separati:

- **runtime operativo**;
- **lane benchmark-only**;
- **sidecar specialistici**;
- **shadow/comparator opt-in**.

In altre parole: lo stack AI può crescere, ma non viene promosso nel flusso
clinico solo perché “sembra andare bene”.

---

## 5. Apple clients

La direzione Apple oggi è più chiara di prima:

- la **web app** resta la base forte;
- la shell **macOS** storica è da preservare come snapshot, non da usare come
  tela infinita per tutto il seguito;
- il lavoro nuovo ruota attorno a **`/api/v1` + TLS locale + home-base**;
- **iPadOS / iOS** sono previsti dentro questo stesso modello paired,
  read-only-first con write paziente esplicito e limitato.

Questa distinzione conta: evita sia il finto “solo web”, sia il finto
“app universale già pronta”.

---

## 6. Sistemi regionali: cosa diciamo davvero

Sul filone SISS/FSE il punto non è “fare vedere un bottone”.
Il punto è mantenere un boundary corretto.

Oggi MediFlow può:

- preparare il contesto paziente;
- fare handoff contestuale;
- richiamare il percorso prescrittivo ufficiale in modalità `webapp-assisted`;
- eseguire pre-check locali dove sensato.

Oggi MediFlow **non** dichiara ancora:

- una integrazione regionale nativa certificata;
- un consumo libero di REST/WS regionali;
- una UI prescrittiva custom che sostituisce il modulo ufficiale.

Questo boundary non è cosmetico: evita di raccontare come pronto qualcosa che
dipende ancora da scenari approvati, qualifica `SSI` e provisioning reale.

---

## 7. Dove guardare dopo questo file

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md)
- [docs/system_architecture.md](./system_architecture.md)
- [docs/ROADMAP.md](./ROADMAP.md)
