# Archivio della 0.9.0 pubblicata (dati inventati)

Backup cifrato completo scritto dal codice del tag `v0.9.0`
(commit `9c7b3adf2eb18551b7c03b61e0fa6ee2303d31d0`, schema SQLite 3). Serve a provare
che un archivio della 0.9.0 si aggiorna, si ripristina e permette il ritorno alla 0.9.0.
Tutti i dati sono inventati, compresi passphrase e chiave di recupero in `fixture.json`.

| File | Contenuto | SHA-256 |
| --- | --- | --- |
| `backup-v090.mediflow-recovery` | backup cifrato completo di un archivio della 0.9.0 | `94e5f4ae409d49f422a0e0091886846ecc93be890e37765afd9647fa02a41ae4` |
| `fixture.json` | kit di recupero, chiave di recupero, passphrase, testi in chiaro attesi | `8cb67e7ad20e87359a707685720d2ac0455042b1b8daa22fe220067595a39fa8` |

Il database dentro il backup ha SHA-256
`ed9fb18228524ed2e94ac71adeb9a50d6a2bc881dbfa40f49899337b428abd9d` e impronta dello schema
(`schemaSnapshot`) `f7a926813c169edfd7c75ce5e6a1d1b9f5b1e9201c7a20456dc557b943bbaac5`.
È la copia dell'archivio che la 0.9.0 mette nel backup (`createRecoverySnapshot`). I test lo decifrano con la chiave di recupero in una cartella temporanea: nessun
database in chiaro sta nel sorgente, perché la guardia degli input di build
(`scripts/build-input-metadata.mjs`) respinge ogni file `.db` o `.sqlite`.

Contenuto: un account amministratore con passphrase e chiave di recupero, tre pazienti
(uno attivo, uno eliminato, uno con codice STP), una nota cifrata, una voce di diario, un
controllo, una terapia, un allegato cifrato, una conversazione, una prescrizione protesica
e una di prestazioni, un'osservazione, un evento di audit, due ricevute di ripristino nelle
impostazioni e la ricevuta di un import del catalogo protesico.

## Rigenerare

Le chiavi sono casuali: una nuova esecuzione dà byte e hash diversi con lo stesso contenuto.
Nel repository si copiano solo `backup-v090.mediflow-recovery` e `fixture.json`; il
`medical.db` prodotto resta fuori. Dopo averla rigenerata, aggiorna gli hash qui sopra
(il test li confronta).

```sh
git worktree add --detach /percorso/tag-v090 v0.9.0
(cd /percorso/tag-v090 && npm ci --ignore-scripts && npm rebuild better-sqlite3 --ignore-scripts=false)
node --import /percorso/tag-v090/scripts/register-strip-types-loader.mjs \
  scripts/archive-v090/produce-fixture.mjs /percorso/tag-v090 /cartella/vuota
```

Il produttore va eseguito con il loader del tag: quello di questo repository risolve gli
alias `@/` verso il codice corrente e mescolerebbe le due versioni.

## Chi la usa

- `lib/archive-v090-in-place-upgrade.test.ts`: aggiornamento sul posto e copia `schema-original-v3`.
- `lib/archive-v090-recovery-restore.test.ts`: ripristino del backup e rifiuto dei backup alterati.
- `scripts/archive-v090/return-to-v090.mjs`: ritorno alla 0.9.0 con il codice del tag (fuori
  dalla CI). Genera al volo, col produttore, una cartella dati vera della 0.9.0 (modalità WAL)
  e ripristina anche il backup di questa cartella.
