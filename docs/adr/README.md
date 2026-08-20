# ADR: Architecture Decision Records

Gli ADR (Architecture Decision Records) tengono traccia delle decisioni che influenzano architettura, confini di sicurezza e manutenibilità nel lungo periodo.

Questa cartella contiene le decisioni di MediFlow (web + native).

## ADR piu recente

- [0093-agent-interface-plane-headless-capability-contract.md](./0093-agent-interface-plane-headless-capability-contract.md): propone una superficie agentica locale completa e versionata, con context lease minimo e autorita applicativa review-first.
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
