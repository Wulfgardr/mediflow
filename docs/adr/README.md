# ADR: Architecture Decision Records

Una scelta architetturale continua a produrre conseguenze anche dopo che il
codice è cambiato. Gli ADR (Architecture Decision Records) ne conservano perciò
problema, alternative e ragioni, così che sia possibile comprendere i confini
di sicurezza e le scelte di manutenzione di MediFlow, sul web e sul nativo.

Le sintesi richiamate sotto descrivono la decisione e il pacchetto iniziale a
cui si riferiscono. L'approvazione di un ADR non equivale alla consegna di un
runtime, e un limite storico della prima implementazione non sostituisce una
verifica dello stato successivo.

<a id="adr-piu-recente"></a>

## Decisioni richiamate

- [0137-rust-boundary-pilot-proposal.md](./0137-rust-boundary-pilot-proposal.md): proposta WUL-706 subordinata al pilota 0.9.1; confronto IPC/FFI, codec isolato e rollback, senza adozione runtime o cambio UI.

- [0125-explicit-aifa-catalog-download.md](./0125-explicit-aifa-catalog-download.md): propone un aggiornamento AIFA richiesto esplicitamente e basato sulla fonte ufficiale.

- [0123-official-web-ui-navigation-compositions.md](./0123-official-web-ui-navigation-compositions.md): definisce la promozione della UI web con B predefinita, A selezionabile e un confronto sintetico separato.

- [0122-local-provider-host-setup.md](./0122-local-provider-host-setup.md): definisce un comando esplicito dell’host per ammettere, recuperare e revocare Ollama, senza affidare queste azioni ai consumer.
- [0121-function-status-projection.md](./0121-function-status-projection.md): espone lo stato delle funzioni in sola lettura, senza inferenza, credenziali o disponibilità dichiarata in assenza di prove.
- [0120-local-work-profile-onboarding.md](./0120-local-work-profile-onboarding.md): definisce una guida locale deterministica, con anteprima e ripristino del profilo della postazione.

- [0119-anydoc-apple-vision-current-source.md](./0119-anydoc-apple-vision-current-source.md): fissa la precedenza del ripiego PDF AnyDoc + Apple Vision, separato da Fabric, con matrice e provenienza dell’anteprima.

<!-- @Codex MF085-002/003: bounded source-bound scale contract. -->
- [0118-tinetti-poma28-source-bound-submission.md](./0118-tinetti-poma28-source-bound-submission.md): propone POMA-28 versionata e vincolata alla fonte, con storico separato, validazione completa e controlli dei writer Web/Swift; non dichiara validazione clinica né nuove soglie.

- [0117-headless-portable-agent-first-and-capability-first-fabric.md](./0117-headless-portable-agent-first-and-capability-first-fabric.md): rende Headless/CLI/MCP, progettati per gli agenti e indipendenti dal sistema operativo, un requisito della 0.8.5; definisce un insieme minimo utile attraverso Application Services e riclassifica OCR come funzione indipendente dal modello, con DeepSeek facoltativo.
- [0116-agentic-checkup-status-transition.md](./0116-agentic-checkup-status-transition.md): accetta la prima scrittura agentica non-SOAP soltanto come transizione `pending -> completed|cancelled` di un checkup esistente: servono proposta AIP, conferma UI specifica per l’operazione, CAS, idempotenza e ricevuta PHI-safe; il pacchetto iniziale resta solo documentale.
- [0115-icd11-who-reference-data-adapter.md](./0115-icd11-who-reference-data-adapter.md): accetta un Application Service ICD-11 sotto l’autorità dell’host, con WHO API v2/MMS/release esplicitamente vincolati, uscita dati solo su scelta, cache sul vincolo esatto e trasporto ufficiale separato; il primo pacchetto usa un trasporto sostitutivo e non migra i chiamanti.
- [0114-intelligent-host-aip-mcp-isolation.md](./0114-intelligent-host-aip-mcp-isolation.md): accetta un processo MCP `stdio` modern-only separato e un broker AIP locale come unico futuro passaggio verso Application Services nominati; la prima slice espone soltanto stato non-PHI.
- [0113-recording-visita-trascrizione-locale-085.md](./0113-recording-visita-trascrizione-locale-085.md): accetta registrazione e trascrizione Apple sul dispositivo nel solo target macOS: richiede consenso esplicito, audio limitato in RAM, trascrizione effimera e revisione separata da ogni writer clinico.
- [0112-provider-v2-secret-broker-and-official-cloud-adapters.md](./0112-provider-v2-secret-broker-and-official-cloud-adapters.md): accetta il contratto provider v2, il broker dei segreti con lease effimero e i trasporti ufficiali OpenAI/Anthropic; mantiene i provider remoti spenti per impostazione predefinita e limita la prima operatività a dati sintetici non clinici.
- [0111-deepseek-ocr2-selective-page-routing.md](./0111-deepseek-ocr2-selective-page-routing.md): accetta il routing PDF selettivo e l'adapter DeepSeek-OCR 2 pin-by-digest; ADR 0117 lo riclassifica come adapter opzionale della capability OCR model-agnostic.
- [0110-riapertura-governata-programma-intelligente-085.md](./0110-riapertura-governata-programma-intelligente-085.md): accetta la riapertura governata della 0.8.5 a DeepSeek-OCR 2 selettivo, provider OpenAI/Anthropic ufficiali, MCP/intelligent host, operazioni agentiche, recording e planner semantico; conserva i boundary local-first e impone packet, gate e claim separati.
- [0109-confini-programma-intelligence-fabric-headless-085.md](./0109-confini-programma-intelligence-fabric-headless-085.md): accetta i confini del candidato 0.8.5 tra quattro proposte Fabric, foundation Headless generale non eseguibile e sola eccezione SOAP H1-H10; registra DeepSeek-OCR 2 e runtime OpenAI/Anthropic come `RELEASE_SCOPE_EXCLUDED` e delimita le direzioni future MCP, recording, compliance e query semantiche.
- [0108-piano-canonico-headless-read-only-085.md](./0108-piano-canonico-headless-read-only-085.md): accetta `66/66` come 66 esiti terminali, non come 66 autorizzazioni: i GET network sono soltanto candidati di evidenza e non concedono alcuna operazione; in assenza dei requisiti il percorso rimane chiuso.
- [0107-anydoc-local-attachment-extraction.md](./0107-anydoc-local-attachment-extraction.md): accetta AnyDoc come unica corsia automatica locale per gli allegati; nel runtime 0.8.5 `ocr` e `unavailable` e le route legacy terminano con `410`. Il requisito DeepSeek-OCR 2 resta escluso dalla patch.
- [0106-web-auth-logout-pin-setup-lifecycle.md](./0106-web-auth-logout-pin-setup-lifecycle.md): completa il lifecycle Web P3 per logout esatto, retirement dopo CAS PIN e setup commit-last; non prova runtime o reset PIN.
- [0105-web-auth-process-integrity-assumption.md](./0105-web-auth-process-integrity-assumption.md): accetta per H1a l'assunzione di integrità process-global e registra il residuo di disponibilità e i gate H1b/security.
- [0104-web-lock-revocation-fence-and-credential-transport.md](./0104-web-lock-revocation-fence-and-credential-transport.md): accetta fence process-local per lock Web e binding control/session; runtime e native restano non implementati.
- [0102-document-synthesis-source-authority.md](./0102-document-synthesis-source-authority.md): fissa per Document Synthesis l’insieme delle fonti sotto l’autorità dell’host, le citazioni validate e una ricevuta destinata soltanto alla revisione.
- [0103-headless-clinician-authorized-soap-entry-write.md](./0103-headless-clinician-authorized-soap-entry-write.md): accetta una sola append SOAP locale a conferma clinica monouso; il candidato integra le evidenze H1-H10, senza trasporto Headless generale, authority Fabric o apply per altre capability.
- [0097-active-role-session-and-step-up-authorization.md](./0097-active-role-session-and-step-up-authorization.md): accetta il prerequisito host-owned, inattivo per default, physician-only e operation-scoped per la sola SOAP; non consegna runtime, proof o write.
- [0100-fabric-vs-headless-semantic-plane.md](./0100-fabric-vs-headless-semantic-plane.md): propone di separare i piani Fabric e Headless, con inventari e controlli SHA distinti; non abilita runtime, cloud o applicazione dei risultati.
- [0099-ocr-document-locator-and-source-currentness.md](./0099-ocr-document-locator-and-source-currentness.md): accetta il contratto fail-closed per locator OCR monouso e currentness della sorgente documentale, con DAG O1a-O5, senza autorizzare runtime o apply.
- [0098-physician-terminal-review-authority.md](./0098-physician-terminal-review-authority.md): propone una funzionalità locale circoscritta per accettare o rifiutare una revisione, con gesto monouso e route assente fino al superamento dei controlli.
- [0096-owner-sessione-selezione-e-lifetime-broker.md](./0096-owner-sessione-selezione-e-lifetime-broker.md): fissa responsabilità legate alla sessione, selezione canonica e broker dei lease.
- [0095-broker-projection-e-servizi-host-per-capability.md](./0095-broker-projection-e-servizi-host-per-capability.md): fissa il ciclo di vita successivo alla configurazione iniziale, la proiezione del broker e servizi host distinti per funzione.
- [0094-intelligence-fabric-headless-contract-085.md](./0094-intelligence-fabric-headless-contract-085.md): definisce l'Application Service Layer condiviso, separa Fabric e AIP e fissa completezza architetturale e operativa.
- [0092-limite-digest-bound-readiness-ai-locale.md](./0092-limite-digest-bound-readiness-ai-locale.md): accetta un'annotazione distinta da `runtime`; il bracket resta detection best-effort.
- [0089-contratto-intelligence-fabric-e-venue-esecutive.md](./0089-contratto-intelligence-fabric-e-venue-esecutive.md): contratto fabric per capability, venue esplicite, profili egress versionati e ricevute di risoluzione fail-closed.
- [0090-giunture-fabric-trust-onboarding-routing-interazione.md](./0090-giunture-fabric-trust-onboarding-routing-interazione.md): contratti di giuntura per trust paired con revoca host, onboarding provider per classe di credenziale, routing osservabile con fallback negato e interazione clinica review-first.
- [0091-candidato-locale-fabric-admissione-continuita-status.md](./0091-candidato-locale-fabric-admissione-continuita-status.md): limita il candidato all’ammissione di provider locali, alla continuità che si arresta se mancano i requisiti, allo stato paired in sola lettura e a un harness sintetico senza uscita dati né scritture cliniche.
- [0087-registro-proposte-diagnostiche-documentali.md](./0087-registro-proposte-diagnostiche-documentali.md): accetta una base persistente locale separata dalle diagnosi cliniche; non introduce writer, route, UI o applicazione delle proposte.
- [0086-intelligent-scaffold-and-graded-automation-boundary.md](./0086-intelligent-scaffold-and-graded-automation-boundary.md): propone una struttura di supporto indipendente dal modello, chiarimenti che non procedono in assenza dei requisiti e automazione graduata, senza aggiungere runtime.
- [0084-document-diagnoses-review-only.md](./0084-document-diagnoses-review-only.md): sostituisce la compilazione automatica ICD da documenti con proposte da rivedere e rifiuta contenitori ambigui.
- [0082-persistent-expectations-register-v0.md](./0082-persistent-expectations-register-v0.md): accetta il registro persistente host-only delle attese v0 con provenienza univoca e chiusura confermata.
- [0081-fhir-r4-export-v0-contract.md](./0081-fhir-r4-export-v0-contract.md): accetta il contratto verificabile per copertura, parità e validazione locale dell'export FHIR R4 v0.

---

## Quando scrivere un ADR

Scrivi un ADR prima di implementare una modifica che incida sui punti seguenti.
La decisione deve precedere il codice proprio quando tornare indietro sarebbe
costoso o cambierebbe le garanzie del sistema:

- modello di cifratura / key derivation / flow PIN
- confini auth/session
- contratti API native (`/api/v1/*`)
- cambi al modello dati che richiedono migrazioni
- networking locale (discovery/pairing/sync)
- aggiunta/rimozione di dipendenze rilevanti
- qualunque scelta difficile da annullare

---

## Valori di stato

Il campo `Status:` ammette solo questi valori. Lo stato riguarda la decisione,
non costituisce da solo una prova di implementazione:

- **Proposed**: decisione in discussione
- **Accepted**: decisione approvata (implementata o pianificata)
- **Superseded**: decisione sostituita da un ADR più recente

---

## Convenzione nomi

- Usa 4 cifre: `0001-...md`
- Titolo corto e specifico
- Una decisione per ADR

---

## Template

Parti da: `0000-template.md`

Mantieni gli ADR brevi e ordinati, accompagnando chi legge dal problema alla
prima porzione di lavoro verificabile:
- problema -> opzioni -> compromessi -> decisione -> prima implementazione circoscritta

---

## Processo operativo

1. Crea un nuovo ADR con stato **Proposed**
2. Discuti in PR/issue
3. Al merge, aggiorna lo stato a **Accepted**
4. Se sostituito, marca **Superseded** e linka il nuovo ADR

- [0129-function-model-catalog-preferences.md](./0129-function-model-catalog-preferences.md): definisce catalogo dell’host, scelta predefinita per esperienza e variazione occasionale; la UI non ammette modelli.

- [0130-node-test-data-dir-preflight.md](./0130-node-test-data-dir-preflight.md): verifica preventivamente la directory dati del launcher dei test Node e interrompe il percorso se i requisiti non sono rispettati.
