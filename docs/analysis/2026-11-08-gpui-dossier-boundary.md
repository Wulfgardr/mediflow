# Import dossier in GPUI: confine di applicazione

Data: 8 novembre 2026. Base verificata: `71c92e002`.
Stato del primo giro: funzione non implementata, confine di scrittura da scegliere.
Secondo giro: consumer GPUI sul percorso host locale nella [PR #883](https://github.com/Wulfgardr/mediflow/pull/883).
Refs [WUL-771](https://linear.app/wulfgardr/issue/WUL-771) e
[WUL-804](https://linear.app/wulfgardr/issue/WUL-804).

La revisione del dossier resta un requisito della 0.9.1. Aprire soltanto
l’estrazione dei file a GPUI non permetterebbe di acquisire il dossier come
nel Web. Mancano, sul canale paired, le scritture dell’artefatto che conserva
identità, decisioni, autorizzazioni dei singoli fatti ed esiti di applicazione.
Il rinvio al browser non risolve questo requisito.

## Confine osservato

Il Web crea l’originale con `parseEvidenceArtifactSnapshot` già valorizzato.
Aggiorna poi lo stesso campo con la precondizione di currentness, prima e
dopo le scritture cliniche. Sono le porte `createAttachment` ed
`updateArtifact` di [document-dossier-ports.ts](../../lib/document-dossier-ports.ts),
usate da [document-dossier-session.ts](../../lib/document-dossier-session.ts).
Il record dossier vive nel campo cifrato esistente, senza una tabella propria.

Il canale paired ha un contratto diverso:

- [network-attachment-write.ts](../../lib/network-attachment-write.ts)
  ammette soltanto `name`, `path`, `data`, `type`, `size` ed
  `expectedCollection`. Rifiuta `id` e `parseEvidenceArtifactSnapshot`,
  anche se cifrato. Il normale caricamento crea l’artefatto a `null`.
- [La route del singolo allegato](../../app/api/v1/network/patients/[id]/attachments/[attachmentId]/route.ts)
  espone GET. Non espone l’aggiornamento dell’artefatto con currentness.
  Questa assenza è dedotta dal codice, non da una prova HTTP di PUT.
- [ADR 0076](../adr/0076-paired-document-domain-write-policy.md)
  classifica questi artefatti come Classe C, riservata a host e Web.
  Una loro scrittura paired richiede una decisione distinta.

Anche [OpenAPI](../openapi/mediflow-v1.yaml) dichiara questi rifiuti
e l’assenza di update paired degli allegati.

Quindi un port che applicasse il dossier tramite le sole porte paired
esistenti richiederebbe una modifica del contratto `/api/v1`. Togliere
l’artefatto, salvare soltanto i fatti o presentare come riuscito il solo
caricamento dell’originale perderebbe le garanzie di
[ADR 0175](../adr/0175-dossier-import-da-cartella.md).

Non è stata dimostrata la necessità di cambiare schema o cifratura: i campi e
i formati esistono già. Non sono stati modificati né quei confini né la route
di estrazione. Quest’ultima è una lettura, non concede le scritture mancanti.

## Alternative e costo del lavoro

I costi sotto sono una stima delle parti da implementare e provare, non
misure di durata. Corpus condiviso, port del verificatore, revisione GPUI,
prove di sensibilità ed equivalenza restano necessari in ogni alternativa.

| Alternativa | Risultato e limite | Lavoro aggiuntivo rispetto al port del verificatore |
| --- | --- | --- |
| Accesso host locale già presente in GPUI | Riusa i writer Web e i campi cifrati esistenti. Solo origine loopback, con seconda autenticazione Web P3 tramite `LocalHostAccess`. Non estende `/api/v1`. | Aggiungere le porte dossier sul trasporto host, collegare l’autenticazione alla revisione, invalidare su cambio scheda, lock, revoca e sostituzione archivio. Provare CAS, audit, rilettura e ritiro della sessione. Aggiornare ADR 0175/0176 per nominare il consumer GPUI. |
| Estensione paired nominata | Consente il dossier con la sessione nativa abbinata, mantenendo scope e capability paired. Cambia `/api/v1` ed il confine di Classe C. | Decidere l’eccezione in ADR 0076, aggiornare OpenAPI, ammettere l’artefatto alla creazione ed esporne il CAS. Verificare anche gli identificativi dei record necessari alla ripresa idempotente. Aggiungere prove positive, negative, concorrenza, revoca ed audit sul confine esteso. |
| Comando host per l’applicazione | Può rendere atomici il controllo dell’artefatto ed una scrittura clinica. Introduce una nuova autorità di scrittura. | Progettare DTO cifrati, autorizzazione, idempotenza e ricevute, con prove transazionali. L’host senza chiave non può assumere il ruolo del verificatore client. È l’alternativa con più modifiche e non serve soltanto a portare il pannello. |

Per il target della 0.9.1, limitato al Mac locale, il riuso di
`LocalHostAccess` è l’alternativa proposta: conserva il contratto paired.
La seconda autenticazione ed il vincolo loopback devono essere accettati
come parte del percorso. È una proposta, non una decisione già applicata.

## Prove eseguite sulla base

Con Node 24.18.0, dipendenze installate senza script e binding SQLite
preparato con verifica SHA-256:

```text
node scripts/run-strip-types.mjs --test \
  lib/network-attachment-write.test.ts \
  lib/domain/documents/dossier-import.test.ts \
  lib/domain/documents/dossier-prepared.test.ts \
  lib/document-dossier-session.test.ts \
  lib/dossier-extraction-route.test.ts

✔ network attachment create accepts the real paired projection and applies server defaults
✔ network attachment create rejects every field outside the allowlist
✔ without a tax code, a patient named in the document blocks a link to a record with another name
ℹ tests 105
ℹ pass 105
ℹ fail 0
ℹ skipped 0
```

Le prove sono quelle esistenti, eseguite con directory dati sintetiche
esplicite e copia legacy disabilitata. Il primo test controlla anche che
`parseEvidenceArtifactSnapshot` sia `null`. Il secondo include il rifiuto
400 di quel campo cifrato. Non sono nuovi difetti del Web.

## Non provato

Nessun verificatore Rust o flusso dossier GPUI è entrato in questa modifica.
Non sono stati prodotti corpus di conformità, attese rigenerabili, test Rust,
mutazioni di sensibilità, catture del renderer o prove GPUI di annullamento,
applicazione parziale e duplicato. I 105 test Web non dimostrano equivalenza
con Rust. G-0 resta aperto su questa funzione.

## Secondo giro: percorso host locale

È stata scelta ed implementata la prima alternativa. GPUI richiede l'apertura
esplicita di `LocalHostAccess`, usa i writer Web esistenti e conserva il confine
paired di Classe C. ADR 0175 e 0176 nominano questo consumer.

La sessione TS del Web è riusata in un processo Node 24 locale senza chiavi o
cookie, con porte controllate in Rust. Il verificatore Rust indipendente è
confrontato con il Web su un corpus sintetico versionato sotto 2 MB. Non sono
esclusi campi dai risultati JSON. Il processo viene interrotto su annullamento,
lock, ritiro dell'accesso o cambio di contesto. Le scritture restano vietate nella
revisione ed ammesse solo per la scheda confermata durante l'applicazione.

Le prove comprendono tutte le dieci falsificazioni, tre mutazioni singole che
fanno fallire la conformità, scritture parziali con ripresa, duplicati, tutti i
writer ordinari usati dal dossier e ritiro del contesto. Le catture dei cinque
stati provengono dal renderer headless dei componenti reali. Provano la
presentazione delle fixture, non una sessione del medico sul desktop.
Restano fuori la validazione clinica, la creazione di schede da documento, l'installazione
del candidato e la verifica su documenti reali.
