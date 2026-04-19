# MediFlow v0.5.0

> Cartella clinica local-first, progettata da un medico per il lavoro di tutti i giorni.
> Dati locali, flusso rapido, cloud solo se scelto e documentato.

---

## Perché esiste

Sono **Leo**, medico di distretto.
MediFlow nasce da un problema molto concreto: nel lavoro clinico quotidiano i software sono spesso lenti, poco leggibili e troppo dipendenti da internet.

Qui l'idea è l'opposto: lavorare bene, in locale, con controllo pieno dei dati e con una struttura abbastanza solida da crescere senza diventare opaca.

## Dove siamo adesso

`v0.5` è il punto che mette in ordine il salto vero rispetto alla `v0.3` esposta pubblicamente.
`v0.4` resta una tappa tecnica importante, ma non è più il frontespizio giusto per raccontare lo stato del progetto.

Su `main`, oggi, ci sono già queste cose:

- **web app locale come superficie primaria** su Mac, con SQLite cifrato e flusso operativo quotidiano più leggibile;
- **contratto locale `/api/v1`** più esplicito, stabile e riusabile per i client Apple;
- **document intelligence reviewable**: smart import, nuova anagrafica da documento e primo artifact `parse/evidence`;
- **stack AI locale più governato**: benchmark separati, lane `benchmark-only` tenute fuori dal runtime e guardrail più chiari;
- **modalità `network home-base` read-only**: pairing esplicito, capability discovery e primo accesso remoto ai pazienti da client paired;
- **boundary SISS più onesto**: handoff contestuale e percorso prescrittivo `webapp-assisted`, senza fingere integrazioni regionali certificate che oggi non ci sono;
- **preview profiles locali** per provare interfaccia, stack AI, review import e contesto SISS senza cambiare checkout.

## Cosa cambia rispetto alla `v0.3`

Il salto, in breve, è questo:

1. **Più struttura sul dato**: SQLite locale, backup artifact, audit trail, contratti API più chiari.
2. **Più prudenza sui flussi AI**: niente automatismi opachi; import, insight e sintesi restano reviewable e separati dalle lane sperimentali.
3. **Più chiarezza sui boundary**: home-base, FSE/SISS, runtime AI, rebuild native e multi-device sono raccontati per quello che sono davvero.
4. **Più continuità operativa**: la web app resta la base forte, mentre il lavoro Apple-native rientra in un disegno coerente invece di restare un ramo laterale.

## Confini dichiarati, senza ambiguità

- **Local-first di default**: nessuna dipendenza cloud obbligatoria.
- **Zero-knowledge a riposo**: senza PIN il dato non è leggibile.
- **Apple clients**: oggi la superficie più solida è la web app sul Mac; la shell macOS storica è congelata e va verso un rebuild controllato; iPadOS e iOS rientrano nella stessa direzione `home-base + paired client`, non in un database remoto esposto.
- **SISS/FSE**: oggi MediFlow orchestra il contesto e richiama i percorsi ufficiali. Non dichiara ancora una integrazione nativa regionale certificata.
- **Preview profiles**: sono toggle locali di prova, utili per verificare fette sperimentali, non claim di prodotto già consolidati.

---

## 📚 Documentazione

### 🩺 Per il medico

- Manuale operativo: [docs/MANUALE.md](./docs/MANUALE.md)
- FAQ rapida: [docs/FAQ.md](./docs/FAQ.md)

### 🧑‍💻 Per sviluppatori / contributori

Inizia da qui:

1. **Mappa canonica della documentazione**
   - [docs/README.md](./docs/README.md)
   - [docs/markdown-index.md](./docs/markdown-index.md)

2. **Visione e confini**
   - [ARCHITECTURE.md](./ARCHITECTURE.md)
   - [SECURITY.md](./SECURITY.md)

3. **Flusso reale del sistema**
   - [docs/walkthrough.md](./docs/walkthrough.md)
   - [docs/topologia-dati-flussi.md](./docs/topologia-dati-flussi.md)
   - [docs/system_architecture.md](./docs/system_architecture.md)

4. **Roadmap e stato**
   - [docs/ROADMAP.md](./docs/ROADMAP.md)
   - [PLANS.md](./PLANS.md)

5. **Decisioni architetturali**
   - [docs/adr/](./docs/adr/README.md)

6. **Apple clients, parity e testing**
   - [docs/NATIVE.md](./docs/NATIVE.md)
   - [docs/native-testing.md](./docs/native-testing.md)
   - [docs/parity-smoke.md](./docs/parity-smoke.md)
   - [docs/parity-click-map-macos.md](./docs/parity-click-map-macos.md)

7. **Compliance, terminologie e boundary regionali**
   - [docs/COMPLIANCE.md](./docs/COMPLIANCE.md)
   - [docs/FSE2-terminology-roadmap.md](./docs/FSE2-terminology-roadmap.md)
   - [docs/siss-baseline.md](./docs/siss-baseline.md)
   - [docs/siss-ssi-a2a-feasibility.md](./docs/siss-ssi-a2a-feasibility.md)
   - [docs/siss-modulo-prescrittivo-regionale.md](./docs/siss-modulo-prescrittivo-regionale.md)

---

## 🍏 Direzione Apple: macOS, iPadOS, iOS

> [!IMPORTANT]
> Il progetto non sta scegliendo tra web app e app Apple: sta costruendo uno stack unico.
> La web app resta la superficie primaria di oggi; il contratto `/api/v1`, il trasporto TLS locale e il boundary `home-base` sono la base comune per il seguito.

Situazione attuale:

- **macOS**: esiste uno shell storico, ma non è il punto su cui stratificare le prossime feature;
- **iPadOS / iOS**: rientrano nel filone paired-client sul nodo `home-base`, ancora in definizione operativa;
- **multi-device**: la first slice già disponibile è `read-only-first`, con pairing esplicito e senza write remoto o sync automatico.

---

## Installazione rapida (computer)

### Prerequisiti minimi

- Node.js (**v20+** consigliato)
- Docker Desktop (**opzionale**, solo per ICD-11)
- Ollama (**opzionale**, solo per AI/OCR locale)

### Avvio tutto-in-uno

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow

npm install
./Start_MediFlow.command
```

Apri: `http://localhost:3000`

> Lo script avvia anche Ollama e ICD-11 se presenti.
> Se non sono installati, MediFlow resta usabile con funzionalità ridotte.

### Verifiche rapide

```bash
npm run lint
npm run build
```

---

## Note legali e GDPR

MediFlow è un progetto open source rilasciato con licenza MIT.

È pensato in ottica **Privacy by Design**, ma l'uso in ambiente clinico reale richiede comunque valutazioni organizzative e legali del Titolare del Trattamento.

**Per impostazione predefinita, i dati non lasciano il dispositivo.**
La garanzia tecnica è nel progetto; la conformità operativa dipende anche dal contesto in cui viene usato.

---

Progettato in Italia.
