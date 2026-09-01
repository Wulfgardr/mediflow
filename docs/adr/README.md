# ADR: Architecture Decision Records

Gli ADR (Architecture Decision Records) tengono traccia delle decisioni che influenzano architettura, confini di sicurezza e manutenibilità nel lungo periodo.

Questa cartella contiene le decisioni di MediFlow (web + native).

## ADR piu recente

- [0109-confini-programma-intelligence-fabric-headless-085.md](./0109-confini-programma-intelligence-fabric-headless-085.md): accetta i confini del candidato 0.8.5 tra quattro proposte Fabric, foundation Headless generale non eseguibile e sola eccezione SOAP H1-H10; registra DeepSeek-OCR 2 e runtime OpenAI/Anthropic come `RELEASE_SCOPE_EXCLUDED` e delimita le direzioni future MCP, recording, compliance e query semantiche.
- [0108-piano-canonico-headless-read-only-085.md](./0108-piano-canonico-headless-read-only-085.md): accetta il significato fail-closed di `66/66` come 66 esiti terminali, con i GET network solo evidence candidate e zero operation grant.
- [0107-anydoc-local-attachment-extraction.md](./0107-anydoc-local-attachment-extraction.md): accetta AnyDoc come unica corsia automatica locale per gli allegati; nel runtime 0.8.5 `ocr` e `unavailable` e le route legacy terminano con `410`. Il requisito DeepSeek-OCR 2 resta escluso dalla patch.
- [0106-web-auth-logout-pin-setup-lifecycle.md](./0106-web-auth-logout-pin-setup-lifecycle.md): completa il lifecycle Web P3 per logout esatto, retirement dopo CAS PIN e setup commit-last; non prova runtime o reset PIN.
- [0105-web-auth-process-integrity-assumption.md](./0105-web-auth-process-integrity-assumption.md): accetta per H1a l'assunzione di integrita process-global e registra il residuo di disponibilita e i gate H1b/security.
- [0104-web-lock-revocation-fence-and-credential-transport.md](./0104-web-lock-revocation-fence-and-credential-transport.md): accetta fence process-local per lock Web e binding control/session; runtime e native restano non implementati.
- [0102-document-synthesis-source-authority.md](./0102-document-synthesis-source-authority.md): fissa il source-set host-owned, le citazioni validate e la receipt review-only per Document Synthesis.
- [0103-headless-clinician-authorized-soap-entry-write.md](./0103-headless-clinician-authorized-soap-entry-write.md): accetta una sola append SOAP locale a conferma clinica monouso; il candidato integra le evidenze H1-H10, senza trasporto Headless generale, authority Fabric o apply per altre capability.
- [0097-active-role-session-and-step-up-authorization.md](./0097-active-role-session-and-step-up-authorization.md): accetta il prerequisito host-owned, inattivo per default, physician-only e operation-scoped per la sola SOAP; non consegna runtime, proof o write.
- [0100-fabric-vs-headless-semantic-plane.md](./0100-fabric-vs-headless-semantic-plane.md): propone piani Fabric e Headless separati, con inventari e gate SHA distinti; non abilita runtime, cloud o apply.
- [0099-ocr-document-locator-and-source-currentness.md](./0099-ocr-document-locator-and-source-currentness.md): accetta il contratto fail-closed per locator OCR monouso e currentness della sorgente documentale, con DAG O1a-O5, senza autorizzare runtime o apply.
- [0098-physician-terminal-review-authority.md](./0098-physician-terminal-review-authority.md): propone la capability locale stretta per accept/reject review, con gesto monouso e route assente fino ai gate.
- [0096-owner-sessione-selezione-e-lifetime-broker.md](./0096-owner-sessione-selezione-e-lifetime-broker.md): fissa owner session-scoped, selezione canonica e broker per lease.
- [0095-broker-projection-e-servizi-host-per-capability.md](./0095-broker-projection-e-servizi-host-per-capability.md): fissa lifecycle post-onboarding, broker projection e servizi host capability-specific.
- [0094-intelligence-fabric-headless-contract-085.md](./0094-intelligence-fabric-headless-contract-085.md): definisce l'Application Service Layer condiviso, separa Fabric e AIP e fissa completezza architetturale e operativa.
- [0092-limite-digest-bound-readiness-ai-locale.md](./0092-limite-digest-bound-readiness-ai-locale.md): accetta un'annotazione distinta da `runtime`; il bracket resta detection best-effort.
- [0089-contratto-intelligence-fabric-e-venue-esecutive.md](./0089-contratto-intelligence-fabric-e-venue-esecutive.md): contratto fabric per capability, venue esplicite, profili egress versionati e ricevute di risoluzione fail-closed.
- [0090-giunture-fabric-trust-onboarding-routing-interazione.md](./0090-giunture-fabric-trust-onboarding-routing-interazione.md): contratti di giuntura per trust paired con revoca host, onboarding provider per classe di credenziale, routing osservabile con fallback negato e interazione clinica review-first.
- [0091-candidato-locale-fabric-admissione-continuita-status.md](./0091-candidato-locale-fabric-admissione-continuita-status.md): limita il candidato a admissione provider locale, continuita fail-closed, stato paired read-only e harness sintetico senza egress o scritture cliniche.
- [0087-registro-proposte-diagnostiche-documentali.md](./0087-registro-proposte-diagnostiche-documentali.md): accetta la foundation persistente locale, separata dalle diagnosi cliniche; writer, route, UI e applicazione restano assenti.
- [0086-intelligent-scaffold-and-graded-automation-boundary.md](./0086-intelligent-scaffold-and-graded-automation-boundary.md): propone lo scaffold model-agnostic, il chiarimento fail-closed e l'automazione graduata senza aggiungere runtime.
- [0084-document-diagnoses-review-only.md](./0084-document-diagnoses-review-only.md): sostituisce l'autofill ICD documentale con proposte review-only e rifiuta envelope ambigui.
- [0082-persistent-expectations-register-v0.md](./0082-persistent-expectations-register-v0.md): accetta il registro persistente host-only delle attese v0 con provenienza univoca e chiusura confermata.
- [0081-fhir-r4-export-v0-contract.md](./0081-fhir-r4-export-v0-contract.md): accetta il contratto verificabile per copertura, parità e validazione locale dell'export FHIR R4 v0.

---

## Quando scrivere un ADR

Scrivi un ADR prima di implementare cambi che impattano:

- modello di cifratura / key derivation / flow PIN
- confini auth/session
- contratti API native (`/api/v1/*`)
- cambi al modello dati che richiedono migrazioni
- networking locale (discovery/pairing/sync)
- aggiunta/rimozione di dipendenze rilevanti
- qualunque scelta difficile da annullare

---

## Valori di stato

Usa solo questi valori in `Status:`:

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

Mantieni gli ADR brevi e ordinati:
- problema -> opzioni -> trade-off -> decisione -> first thin slice

---

## Processo operativo

1. Crea un nuovo ADR con stato **Proposed**
2. Discuti in PR/issue
3. Al merge, aggiorna lo stato a **Accepted**
4. Se sostituito, marca **Superseded** e linka il nuovo ADR
