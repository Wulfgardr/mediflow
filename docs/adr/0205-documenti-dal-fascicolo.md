# ADR 0205: documenti dal Fascicolo Sanitario Elettronico nell'import Dossier

Data: 2026-11-25. Stato: **Proposed**.
Riferimenti: WUL-949, [ADR 0158](./0158-territorial-packs.md), [ADR 0177](./0177-moduli-di-giurisdizione.md), ADR 0175 e 0176 (dossier da cartella ed estrazione preparata, ritirati dall'albero ma vigenti nel codice di `lib/document-dossier-session.ts`).

## Contesto

Fuori da MediFlow c'è un'estensione di Chrome, separata dal repository, che dentro la sessione SISS aperta dal medico scarica per categoria i documenti di un paziente dal Fascicolo Sanitario Elettronico lombardo. Li salva in una cartella piatta `FSE_<codice fiscale>` con nomi `AAAA-MM-GG_<CAT>_<Tipo>_<Ente>_<impronta>.<ext>`, dove `<CAT>` è `LAB`, `REF`, `PSS`, `VAC` o `AMM` e l'impronta è un identificativo di otto cifre esadecimali del documento nel Fascicolo. Il 25 novembre 2026 Leonardo ha deciso di collegarla subito al flusso di lavoro.

## Decisione

1. **Confine.** MediFlow non parla con il portale SISS: nessuna chiamata a `operatorisiss.servizirl.it`, nessuna sessione, nessuna credenziale. Legge soltanto la cartella che il medico sceglie sul disco. L'estensione resta uno strumento separato.
2. **Modulo Lombardia.** Il lettore della cartella sta in `lib/territorial/lombardia/fse-folder.ts`; il pulsante «Documenti dal Fascicolo» compare solo con `core+it+lom`, nella sezione «SISS e FSE» della scheda, nell'import Dossier e nella Nuova scheda. Il nucleo non importa il modulo: l'inventario del Dossier riceve dal chiamante tre dati generici, la categoria dichiarata per file, il codice fiscale dichiarato dalla provenienza e la scheda di cui saltare i documenti già importati.
3. **Un gesto dalla scheda.** Il medico sceglie la cartella. Prima di leggere un solo byte MediFlow confronta il codice fiscale nel nome della cartella con quello della scheda: se è diverso, o se la scheda non ha codice fiscale, si ferma lì e lo dice. Se coincide, porta in memoria i riferimenti ai file all'import Dossier della stessa scheda, senza URL, senza storage del browser, e la selezione cade al blocco della sessione.
4. **Identità sui dati correnti.** Il codice della cartella diventa `declaredTaxCode` del gruppo. Una scheda di destinazione con un altro codice, o un documento che porta il codice fiscale di un altro paziente, blocca il gruppo con stato `discordant`. Il controllo si ripete nell'acquisizione, sui dati riletti, quindi vale anche se il medico cambia la scheda di destinazione. Restano tutti i controlli di identità del Dossier sul testo letto da MediFlow.
5. **Categoria e data dal nome.** La categoria del nome diventa la classe del documento (`LAB` referto di laboratorio, `REF` referto specialistico o di imaging se il tipo nomina radiologia o immagini, `AMM` amministrativo; `PSS` e `VAC` restano alla classificazione ordinaria) e si mostra nell'inventario. La data del nome vale quando il testo non ha una data etichettata, come per ogni nome `AAAA-MM-GG`. Un nome che non segue il formato non si legge e il medico vede quanti file sono stati lasciati fuori.
6. **Già importati.** I documenti con gli stessi byte di una fonte già nel dossier della scheda si mostrano come «Già importato: saltato»: non si estraggono e non si riscrivono. Il riconoscimento è per impronta SHA-256 dei byte, mai per nome, e vale solo se la conservazione di quell'originale è verificata e legata alla fonte host attuale (`preservationIsCurrent`). Un record in attesa di rilettura, con rilettura diversa o con l'originale archiviato cambiato torna al percorso ordinario, che rilegge i byte archiviati (`verifyReadback`).
7. **Nessuna scritta clinica diretta.** Tutto il resto entra in revisione come ogni altro documento del Dossier: originale cifrato, testo, proposte da decidere, scritture solo dopo il gesto del medico.

## Che cosa entra e che cosa resta fuori

| Entra in MediFlow | Resta fuori |
|---|---|
| I file della cartella con il nome del Fascicolo, cifrati come allegati, con il loro percorso relativo (che contiene il codice fiscale della scheda) dentro l'artefatto cifrato | Sessione SISS, cookie, credenziali, consenso e dati letti nel portale |
| Categoria e data dal nome, come dati del record dossier | L'indice dei documenti già scaricati che l'estensione tiene in `chrome.storage.local`, indicizzato per SHA-256 del codice fiscale |
| | I file con un nome fuori formato, i documenti già importati, le cartelle di un altro paziente |

## Dove restano i file e per quanto

L'estensione salva con `chrome.downloads` nella cartella dei download di Chrome (di solito `~/Downloads`), sottocartella `FSE_<codice fiscale>`, sovrascrivendo un file con lo stesso nome. Ha anche una via che scrive in una cartella scelta dal medico con l'accesso ai file del browser. I file restano sul disco finché qualcuno non li cancella; la cronologia dei download di Chrome conserva nomi e percorsi, quindi il codice fiscale nel nome della cartella.

**Proposta di pulizia.** Il consiglio di cancellare la cartella compare solo quando ogni file della cartella scelta ha l'originale in MediFlow, riletto identico. Il conteggio comprende tutti i gruppi in cui l'inventario divide la cartella, per esempio quando un'estrazione preparata ne copre solo una parte, e i file lasciati fuori perché il nome non è del Fascicolo. Un file già importato conta solo con la conservazione verificata e attuale del punto 6; una copia identica conta se il suo originale è al sicuro. Rilettura non verificata o diversa, fonte esclusa, formato non ammesso, identità da confermare o salvataggio non ancora fatto tengono il consiglio nascosto: nel dubbio non compare. Il criterio sta in `lib/dossier-folder-settlement.ts`.

Il testo è «Tutti i N file della cartella sono in MediFlow, riletti identici. Puoi cancellare la cartella dai Download.» (con un solo file, «Il file della cartella è in MediFlow, riletto identico.»). Il numero resta perché il medico può confrontarlo con quanti file ha scaricato l'estensione. La forma «N su N» non serve: il consiglio compare solo quando i due numeri coincidono, e un conteggio parziale accanto a un invito a cancellare suggerirebbe che cancellare sia possibile anche prima. MediFlow non cancella file del disco: la cancellazione resta un gesto del medico, insieme alla voce nella cronologia dei download di Chrome.

## Non verificato

- Se ogni scaricamento lascia nel Fascicolo un accesso che il paziente vede nel proprio registro degli accessi.
- Se le condizioni d'uso del portale operatori ammettono lo scarico automatico o in blocco dei documenti.
- Che il canale ufficiale per un gestionale richieda una registrazione presso ARIA; questa decisione non lo sostituisce.

Restano punti da chiarire prima dell'uso oltre la prova di Leonardo. Riga proposta per i limiti delle note di rilascio:

> Documenti dal Fascicolo: MediFlow importa la cartella scaricata dall'estensione separata di Chrome e non parla con il portale SISS. Non sono verificati il registro degli accessi visibile al paziente, le condizioni d'uso del portale per lo scarico in blocco e la registrazione presso ARIA richiesta dal canale ufficiale.

## Conseguenze

- `DossierSourceStatus` ha lo stato `already_imported`, generico: un altro ingresso può chiedere di saltare i documenti già nel dossier di una scheda.
- La ripresa dell'estrazione conserva la classe dichiarata quando il documento ne ha una.
- Nessun cambio di schema, OpenAPI, cifratura o writer.
