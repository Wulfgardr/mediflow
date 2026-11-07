# ADR 0178: conservazione dei dati sanitari per giurisdizione

Data: 2026-11-03. Stato: Proposed.
Decisione di Leonardo del 3/11/2026: la conservazione entra nella 0.9.1 con
finestre configurabili; sostituisce il rinvio del 30/10/2026 registrato nel
[contratto 0.9.1](../releases/0.9.1-contract.md).
Riferimenti: ADR 0066 (cancellazione logica e purge), ADR 0080 (versione di
schema), ADR 0158 (pacchetti territoriali), ADR 0170.

Questo ADR non è un parere legale e non attesta la conformità del prodotto.
Le durate richiedono la validazione del titolare del trattamento per ente,
rapporto, tipo di documento e procedimento.

## Problema

MediFlow conserva fascicoli senza termine e offre soltanto una cancellazione
amministrata di un paziente già eliminato logicamente (ADR 0066). Non esiste
un termine per categoria, una decorrenza, un blocco per contenzioso né una
ricevuta dello scarto. MediFlow è usato anche fuori dall'Italia; la Lombardia
è un modulo territoriale.

## Fonti

Ricerca del 30/10/2026 (documento di lavoro fuori dal repository), fonti primarie:

| Fonte | Contenuto usato |
| --- | --- |
| [Garante, provvedimento n. 55 del 7 marzo 2019, sez. 3](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9091942) | Senza termine normativo specifico lo stabilisce motivatamente il titolare. |
| Circolare Min. Sanità n. 61 del 19 dicembre 1986, richiamata da [SIUSA, Ministero della Cultura](https://siusa-archivi.cultura.gov.it/cgi-bin/siusa/pagina.pl?Chiave=3&RicProgetto=carte&TipoPag=profdocgen) | Cartelle cliniche di ricovero e referti: conservazione illimitata. Originale non reperito sul sito del Ministero. |
| [DM Sanità 14 febbraio 1997, art. 4](https://sa-fvg.cultura.gov.it/fileadmin/normativa/d.m._Sanita_14_feb._1997.pdf) | Iconografia radiologica almeno 10 anni; referti a tempo indeterminato. Continuità dopo il d.lgs. 101/2020 non verificata su testo consolidato. |
| [Regione Lombardia, titolario e massimario rev04](https://www.regione.lombardia.it/sanita/monitoraggio-dei-servizi-sanitari/gestione-della-documentazione-sanitaria), decreto n. 15229 del 1/12/2017, titolo 3, classe 4.01, p. 34 del PDF | Fascicolo ambulatoriale e documenti di supporto 10 anni dalla chiusura (30 per attività chirurgica); referti di laboratorio 5 anni; prescrizioni illimitate se in cartella clinica, 5 anni gli altri esemplari; referti radiologici illimitati; iconografia 10 anni. |

Il 3/11/2026 una ricerca ha confermato la pubblicazione del PDF rev04 anche
presso la [Soprintendenza archivistica della Lombardia](https://sab-lom.cultura.gov.it/fileadmin/risorse/documenti_pagine/strumenti_per_enti_sanitari_e_camere___commercio/Titolario_e_Massimario_RL__vers04_2018_.pdf);
le righe del massimario non sono state rilette in questa revisione.

## Decisione

### Profilo per giurisdizione, agganciato ai pacchetti territoriali

Il profilo non è una scelta separata: deriva dal preset del pacchetto
territoriale dell'host (ADR 0158), con la stessa autorità e lo stesso audit.

| Preset | Profilo |
| --- | --- |
| `core` | Nessun profilo: il titolare fissa le finestre; senza finestra nulla scade. |
| `core+it` | Italia, base nazionale. |
| `core+it+lom` | Lombardia, massimario rev04, sopra la base nazionale. |

### Classificazione

La tabella `RETENTION_CLASSIFICATION` in `lib/retention-policy.ts` è l'unica
fonte: assegna una categoria a ogni tabella figlia di `PATIENT_CHILD_TABLES`
(tipizzata sullo stesso elenco, quindi una tabella nuova non compila senza
classificazione). Ogni categoria ha una prova.

| Categoria | Dati MediFlow | Italia | Lombardia |
| --- | --- | --- | --- |
| Fascicolo ambulatoriale | scheda paziente, voci visita/telefonata/accesso/nota/remoto/scala, checkup, proposte diagnostiche, sedi | titolare | 10 anni (fonte) |
| Documentazione di ricovero | voci `hospitalization` | illimitata (prudenza, circ. 61/1986) | illimitata |
| Referto diagnostico non specificato | voci `exam` | illimitata (prudenza, DM 1997) | illimitata (prudenza, rev04) |
| Referto di laboratorio | osservazioni | titolare | 5 anni (fonte) |
| Iconografia radiologica | allegati `application/dicom` | 10 anni (fonte) | 10 anni (fonte) |
| Prescrizione (copia nella scheda) | terapie, prescrizioni di prestazioni e voci, protesica, passaggi SISS | titolare | 5 anni (fonte, «altri esemplari») |
| Documento allegato non classificato | altri allegati | illimitata (prudenza) | illimitata (prudenza) |
| Voce di tipo non riconosciuto | tipo di voce ignoto | illimitata in ogni profilo | illimitata |

«Prudenza» indica che il dato potrebbe rientrare in una classe illimitata e
MediFlow non sa distinguerlo. Per la prescrizione, la copia nella scheda
ambulatoriale è letta come «altro esemplare»: il massimario distingue la
cartella clinica di ricovero dal fascicolo ambulatoriale. È un'interpretazione
da validare.

### Unità di scarto e decorrenza

L'unità di revisione e di scarto è il **fascicolo del paziente**, non il
singolo documento: la ricerca avverte che i termini di categoria non
permettono di separare componenti di un fascicolo soggetto a termine più
lungo. Un fascicolo è valutato solo se archiviato e non eliminato.

- Ogni termine decorre dalla **chiusura del fascicolo**: è l'evento del
  massimario per il fascicolo ambulatoriale e la scelta più conservativa
  per le categorie la cui fonte non indica l'evento.
- MediFlow non registra la data di archiviazione. La chiusura è stimata per
  eccesso con l'ultima data nota del fascicolo (paziente e tabelle figlie,
  colonne elencate nella classificazione). Una stima più tarda allunga il
  termine, non lo anticipa.
- Scadenza = chiusura + il termine più lungo fra le categorie presenti.
  Una categoria illimitata, una categoria senza finestra o una chiusura non
  ricavabile rendono il fascicolo non scartabile.

### Finestre del titolare

Le finestre (anni interi da 1 a 100, oppure illimitata) possono solo allungare
il minimo del profilo: il server rifiuta valori inferiori e ogni modifica a
categorie illimitate. Il termine applicato è sempre il massimo fra minimo
attuale e finestra salvata, anche dopo un cambio di profilo.

### Nessuna cancellazione automatica

Un fascicolo scaduto entra nell'elenco «Da rivedere» in Impostazioni,
Conservazione. Lo scarto richiede una sessione Web admin, la conferma
esplicita, la versione corrente del paziente e la stessa scadenza mostrata
al medico. Sotto un unico lock IMMEDIATE l'host rivaluta, ritira l'identità,
cancella con la cascata canonica di `lib/patient-cascade.ts` e scrive l'evento
`retention.fascicolo.discarded` con profilo, categoria, termine, decorrenza,
fonte, chiusura stimata, scadenza e righe rimosse. Un errore annulla tutto.

### Blocchi per contenzioso o richiesta

Un blocco su paziente o su documento (motivo fra contenzioso, richiesta
dell'interessato o di accesso, ispezione, altro) sospende lo scarto del
fascicolo e anche la cancellazione amministrata di ADR 0066
(`/api/system/purge-patient`). Registrazione e revoca sono tracciate in audit.
Un elenco dei blocchi illeggibile vale come blocco.

Il blocco ferma anche l'eliminazione ordinaria di un documento allegato
(`DELETE /api/attachments/[id]`): un blocco sul documento ferma quel documento,
un blocco sul fascicolo ferma tutti i documenti del paziente. Il server risponde
409 `legal_hold` e la scheda Documenti dice che il documento è sospeso da un
blocco. Aggiornamento del 7/11/2026: prima il blocco su documento sospendeva
soltanto lo scarto e la cancellazione amministrata, e il documento bloccato si
poteva eliminare dalla scheda.

### Stato e schema

Finestre e blocchi vivono in due chiavi `settings` (`retention.windows`,
`retention.holds`) con revisione CAS, registrate come non scrivibili dai canali
generici in `lib/security/settings-write-policy.ts`. Nessuna colonna o tabella
nuova: la versione di schema (ADR 0080) non cambia. Uno stato illeggibile non
produce scaduti.

## Backup, copie e audit

- Lo scarto non riscrive i backup già prodotti né le esportazioni consegnate.
  Il ripristino completo di un backup precedente riporta il fascicolo, i blocchi
  e le finestre dell'epoca; il fascicolo torna nell'elenco da rivedere. Limite noto.
- Il ripristino portabile non sovrascrive `settings`: blocchi e finestre dell'host restano.
- WAL, pagine libere, snapshot del sistema e copie di riparazione possono
  conservare valori precedenti (matrice dei dati a riposo). Lo scarto non è
  una bonifica del supporto.
- `audit_events` resta append-only e non è soggetto a scarto in questa versione.

## Limiti

- Nessuna classificazione per singolo documento allegato.
- Attività chirurgica (30 anni nel massimario) non distinta.
- FSE, chat e provider esterni fuori perimetro.
- Autorizzazione allo scarto prevista dal d.lgs. 42/2004 per archivi pubblici
  e privati tutelati: non verificata da MediFlow, spetta al titolare.
- Client Apple e GPUI non mostrano la conservazione; non leggono né scrivono
  le nuove chiavi.
