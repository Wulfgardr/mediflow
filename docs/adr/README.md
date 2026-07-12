# ADR: Architecture Decision Records

Gli ADR (Architecture Decision Records) tengono traccia delle decisioni che influenzano architettura, confini di sicurezza e manutenibilità nel lungo periodo.

Questa cartella contiene le decisioni di MediFlow (web + native).

## ADR piu recente

- [0077-ai-provider-abstraction-and-egress-anonymization-boundary.md](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md): adapter provider AI, registry per ruolo e confine fail-closed per l'egress opzionale.

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
