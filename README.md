<div align="center">

# 🩺 MediFlow

**Cartella clinica territoriale local-first, progettata da un medico per il lavoro di tutti i giorni.**

Dati sul tuo Mac, flusso rapido in visita, AI locale sempre rivedibile.
Il cloud non è un requisito: entra solo se scelto e documentato.

`v0.7` · Web app locale · Home-base macOS · Client Apple paired · SQLite cifrato · MIT

[Stato del sistema](./docs/STATE_OF_THE_SYSTEM.md) · [Manuale](./docs/MANUALE.md) · [Architettura](./ARCHITECTURE.md) · [Sicurezza](./SECURITY.md) · [Roadmap](./docs/ROADMAP.md)

</div>

---

## 🩺 Perché esiste

Sono **Leo**, medico di distretto.
MediFlow nasce da un problema molto concreto: nel lavoro clinico quotidiano i
software sono spesso lenti, poco leggibili e troppo dipendenti da internet.

Qui l'idea è l'opposto: lavorare bene, in locale, con controllo pieno dei dati
e con una struttura abbastanza solida da crescere senza diventare opaca. Non un
gestionale che chiede al medico di adattarsi alla macchina, ma una cartella
clinica che prova a rispettare il modo reale in cui si lavora: visita, appunto,
documento, terapia, dubbio, revisione, continuità.

## ✅ Dove siamo adesso

`v0.7` racconta MediFlow per quello che sta diventando: non solo una web app
clinica con AI, ma un sistema locale ibrido. Il Mac resta il nodo autorevole,
la web app resta la superficie più completa, il contratto `/api/v1` tiene aperta
la strada ai client Apple paired e la document intelligence cresce come
evidenza rivedibile, non come automatismo opaco.

Su `main`, oggi, ci sono già queste cose:

- **web app locale come superficie primaria** su Mac, con SQLite cifrato e flusso quotidiano più leggibile;
- **Kree8 cockpit come root web live**: la home locale apre la nuova grammatica visuale, senza selector o preview profiles persistiti; la passata 2026-06 porta copy più asciutto, palette semantica sobria, dark mode completa e flusso a un clic verso la Scheda paziente;
- **contratto locale `/api/v1`** più esplicito, stabile e riusabile per client nativi e superfici locali;
- **modalità `network home-base` paired**: pairing esplicito, capability discovery, lettura pazienti e write versionati per profilo/status, diario clinico, terapie, checkup e osservazioni;
- **Mac packaged come home-base**: il bundle macOS può gestire backend web production e proxy TLS, con diagnostica read-only dei servizi locali opzionali;
- **client iPhone/iPad paired non-AI**: consultazione, cache cifrata degradabile e primi workflow online versionati, senza accesso diretto a SQLite e senza coda offline automatica;
- **document intelligence reviewable**: Smart Import, nuova anagrafica da documento, artifact `parse/evidence`, ancore fonte, benchmark di assorbimento evidenza e fallback OCR Apple Vision solo su macOS quando il primario locale e low-signal;
- **domini clinici più puliti**: le prestazioni prescritte hanno un dominio separato dalle terapie farmacologiche, con item figli e matching repertorio preparato ma non spacciato per invio regionale;
- **stack AI locale più governato**: benchmark separati, lane `benchmark-only` fuori dal runtime clinico e claims guard contro formulazioni troppo ampie;
- **boundary SISS/FSE onesto**: handoff contestuale e percorso prescrittivo `webapp-assisted`, senza dichiarare integrazioni regionali certificate che oggi non ci sono.

Per una lettura completa, aggiornata e navigabile dello stato reale del sistema
parti da [docs/STATE_OF_THE_SYSTEM.md](./docs/STATE_OF_THE_SYSTEM.md). È la
pagina che unisce prodotto, architettura, sicurezza, runtime, boundary SISS/FSE,
AI/document intelligence, Apple clients e split private/OSS senza costringere a
ricostruire il quadro da dieci file separati.

## 🧭 Cosa cambia rispetto alla `v0.3`

Il salto, in breve, è questo:

1. **Più struttura sul dato**: SQLite locale, backup artifact, audit trail, contratti API più chiari.
2. **Più prudenza sui flussi AI**: niente automatismi opachi; import, insight e sintesi restano reviewable e separati dalle lane sperimentali.
3. **Più chiarezza sui boundary**: home-base, FSE/SISS, runtime AI, rebuild native e multi-device sono raccontati per quello che sono davvero.
4. **Più continuità operativa**: la web app resta la base forte, mentre il lavoro Apple-native rientra in un disegno coerente invece di restare un ramo laterale.
5. **Più concretezza multi-device**: il Mac diventa davvero nodo `home-base`, con client paired e write limitati/versionati già tracciati, pur senza dichiarare sync completo.
6. **Più autorevolezza nella forma**: la presentazione pubblica deve essere sobria, clinica e verificabile; elegante nel linguaggio, ma senza vendere come fatto ciò che è ancora ricerca.

## ⚠️ Confini dichiarati, senza ambiguità

- **Local-first di default**: nessuna dipendenza cloud obbligatoria.
- **Zero-knowledge a riposo**: senza PIN il dato non è leggibile.
- **Apple clients**: la web app resta la superficie più solida sul Mac; il bundle macOS home-base è la nuova base runtime packaged; iPadOS e iOS rientrano nella stessa direzione `home-base + paired client`, non in un database remoto esposto.
- **SISS/FSE**: oggi MediFlow prepara il contesto e richiama percorsi ufficiali. Non dichiara integrazione nativa regionale certificata, sincronizzazione FSE, writeback o invio prescrittivo da MediFlow.
- **Shell web ufficiale**: su `main` esiste una sola direzione live, il cockpit Kree8 sulla root locale; eventuali nuove slice sperimentali non vivono come selector runtime persistito.

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

## 🍎 Direzione Apple: macOS, iPadOS, iOS

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

## ⚙️ Installazione rapida (computer)

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

## ⚖️ Note legali e GDPR

MediFlow è un progetto open source rilasciato con licenza MIT.

È pensato in ottica **Privacy by Design**, ma l'uso in ambiente clinico reale richiede comunque valutazioni organizzative e legali del Titolare del Trattamento.

**Per impostazione predefinita, i dati non lasciano il dispositivo.**
La garanzia tecnica è nel progetto; la conformità operativa dipende anche dal contesto in cui viene usato.

---

Progettato in Italia.
