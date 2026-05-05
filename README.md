# MediFlow v0.6.0

> Cartella clinica local-first, progettata da un medico per il lavoro di tutti i giorni.
> Dati locali, flusso rapido, cloud solo se scelto e documentato.

---

## Perché esiste

Sono **Leo**, medico di distretto.
MediFlow nasce da un problema molto concreto: nel lavoro clinico quotidiano i software sono spesso lenti, poco leggibili e troppo dipendenti da internet.

Qui l'idea è l'opposto: lavorare bene, in locale, con controllo pieno dei dati e con una struttura abbastanza solida da crescere senza diventare opaca.

## Dove siamo adesso

`v0.6` è la prima release che racconta MediFlow come sistema locale ibrido e non
solo come web app clinica con AI. `v0.5` resta il consolidamento AI/UI; `v0.6`
formalizza il salto su home-base, client Apple paired, document intelligence
artifact-first e governance operativa ripulita.

Su `main`, oggi, ci sono già queste cose:

- **web app locale come superficie primaria** su Mac, con SQLite cifrato e flusso operativo quotidiano più leggibile;
- **contratto locale `/api/v1`** più esplicito, stabile e riusabile per i client Apple;
- **document intelligence reviewable**: smart import, nuova anagrafica da documento, primo artifact `parse/evidence` e fallback OCR Apple Vision solo su macOS quando il primario locale e low-signal;
- **stack AI locale più governato**: benchmark separati, lane `benchmark-only` tenute fuori dal runtime e guardrail più chiari;
- **modalità `network home-base` paired**: pairing esplicito, capability discovery, accesso remoto ai pazienti e write versionati per profilo/status, diario clinico, terapie, checkup e osservazioni da client paired;
- **Mac packaged come home-base**: il bundle macOS usa la shell Apple/home-base come entrypoint, può gestire backend web production e proxy TLS, e mostra diagnostica read-only dei servizi locali opzionali;
- **client iPhone/iPad paired non-AI**: consultazione, cache cifrata degradabile e primi CRUD online versionati sui moduli core, senza accesso diretto a SQLite e senza coda offline automatica;
- **boundary SISS più onesto**: handoff contestuale e percorso prescrittivo `webapp-assisted`, senza fingere integrazioni regionali certificate che oggi non ci sono;
- **corpus documentale SISS/FSE locale**: fonti approvate, sync incrementale e report di freschezza restano fuori dal runtime clinico ma guidano le integrazioni future;
- **Clinical Workbench unico e live**: AI, Smart Import review e contesto paziente SISS vivono nella shell ufficiale senza selector preview su `main`.

Per una lettura completa, aggiornata e navigabile dello stato reale del sistema,
parti da [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md). È la
pagina che unisce prodotto, architettura, sicurezza, runtime, boundary SISS/FSE,
AI/document intelligence, Apple clients e split private/OSS senza dover
ricostruire il quadro da dieci file separati.

## Cosa cambia rispetto alla `v0.3`

Il salto, in breve, è questo:

1. **Più struttura sul dato**: SQLite locale, backup artifact, audit trail, contratti API più chiari.
2. **Più prudenza sui flussi AI**: niente automatismi opachi; import, insight e sintesi restano reviewable e separati dalle lane sperimentali.
3. **Più chiarezza sui boundary**: home-base, FSE/SISS, runtime AI, rebuild native e multi-device sono raccontati per quello che sono davvero.
4. **Più continuità operativa**: la web app resta la base forte, mentre il lavoro Apple-native rientra in un disegno coerente invece di restare un ramo laterale.
5. **Più concretezza multi-device**: il Mac diventa davvero nodo `home-base`, con client paired e write limitati/versionati già tracciati, pur senza dichiarare sync completo.

## Confini dichiarati, senza ambiguità

- **Local-first di default**: nessuna dipendenza cloud obbligatoria.
- **Zero-knowledge a riposo**: senza PIN il dato non è leggibile.
- **Apple clients**: la web app resta la superficie più solida sul Mac; il bundle macOS home-base è la nuova base runtime packaged; iPadOS e iOS rientrano nella stessa direzione `home-base + paired client`, non in un database remoto esposto.
- **SISS/FSE**: oggi MediFlow orchestra il contesto e richiama i percorsi ufficiali. Non dichiara ancora una integrazione nativa regionale certificata.
- **Shell web ufficiale**: su `main` esiste un solo `Clinical Workbench`; eventuali nuove slice sperimentali non vivono come selector runtime persistito.

---

## 📚 Documentazione

### 🩺 Per il medico

- Manuale operativo: [docs/MANUALE.md](./docs/MANUALE.md)
- FAQ rapida: [docs/FAQ.md](./docs/FAQ.md)

### 🧑‍💻 Per sviluppatori / contributori

Inizia da qui:

1. **Mappa canonica della documentazione**
   - [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md)
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

- [docs/NATIVE.md](./docs/NATIVE.md)
- [docs/native-testing.md](./docs/native-testing.md)
- [docs/mobile-home-base-smoke.md](./docs/mobile-home-base-smoke.md)
- [docs/parity-smoke.md](./docs/parity-smoke.md)
- [docs/parity-click-map-macos.md](./docs/parity-click-map-macos.md)
- [docs/native-setup.md](./docs/native-setup.md)
- [docs/native-launch.md](./docs/native-launch.md)
- [docs/local-api-tls.md](./docs/local-api-tls.md)

Situazione attuale:

- **macOS**: il bundle home-base è il nuovo entrypoint packaged; la vecchia shell clinica resta snapshot storico/parity;
- **iPadOS / iOS**: rientrano nel filone paired-client sul nodo `home-base`, con primi workflow non-AI online e cache cifrata degradabile;
- **multi-device**: la first slice già disponibile è `read-only-first`, con write espliciti e versionati per profilo/status paziente, diario clinico, terapie, checkup e osservazioni, senza hard delete remoto, attachment remoti, cataloghi o sync automatico.

---

## Installazione rapida (computer)

### Prerequisiti minimi

- Node.js (**v20+** consigliato)
- Docker Desktop (**opzionale**, solo per ICD-11)
- Ollama (**opzionale**, runtime AI e OCR primario locale)

Su macOS, MediFlow puo usare Apple Vision come fallback OCR locale quando
Ollama/DeepSeek OCR restituisce testo vuoto o degenerato. Su Windows e Linux non
esiste oggi un fallback OCR platform-specific equivalente certificato: il flusso
usa l'OCR primario locale, testo gia presente nel documento, oppure fallisce in
modo esplicito se non c'e testo utile.

### Avvio stack web locale

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow

npm install
./Start_MediFlow.command
```

Apri: `http://localhost:3000`

> Lo script avvia anche Ollama e ICD-11 se presenti.
> Non avvia i client Apple: macOS, iPadOS e iOS restano su un filone e su launcher separati.
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
