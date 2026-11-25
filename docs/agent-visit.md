# Deposito della visita da un client agente

Il client deposita una visita cifrata nella cassetta di MediFlow. La ricevuta
conferma il deposito. La scheda Web sbloccata verifica l’identità nei PDF e
mostra la visita in «In arrivo». Nota, trascrizione, PDF, terapie,
prestazioni, diagnosi, esenzioni ed osservazioni entrano in cartella solo con
il gesto del medico ([ADR 0195](./adr/0195-materiale-dell-agente-dopo-il-gesto-del-medico.md)).

Il contratto è [ADR 0190](./adr/0190-mandato-agenti-e-cassetta-della-visita.md).
Il client richiede Node 24 e le dipendenze della checkout. I comandi seguenti
si eseguono dalla radice della repository.

## Collegare il client

In MediFlow, sbloccare con la credenziale dell’account, aprire Impostazioni, Agenti e creare
un mandato fino a 24 ore. Il PIN conferma il mandato, che indica operazioni,
fornitore del modello e autorizzazione ad inviare dati clinici al fornitore.

```sh
npm run agent:visita -- collega --origine http://127.0.0.1:3000 --nome "Fine visita"
```

Usare l’origine dell’istanza locale aperta. Il comando restituisce `requestId`
e `code`. Confrontare il codice nella pagina Agenti ed approvarlo, poi eseguire:

```sh
npm run agent:visita -- completa --richiesta UUID-DELLA-RICHIESTA
```

Conservare `agentRef` dalla ricevuta. Dopo lo sblocco con PIN o passphrase, o dopo
«Rinnova accesso» riuscito, il client registrato può ritirare il mandato di 24 ore. «Blocca», la revoca
in Agenti o la scadenza del mandato interrompono l’accesso. «Esci», il blocco per inattività, la
chiusura del browser e il riavvio del server non lo interrompono.

```sh
npm run agent:visita -- ritira --agente UUID-AGENTE
```

`deposita` ritira il mandato da sé se quello in uso è scaduto o il server lo
rifiuta. In MCP, il comando esplicito è `mediflow_ritira_mandato`.

Il token rimane in un file privato 0600,
fuori dalle cartelle sincronizzate. Il client usa soltanto HTTP loopback,
senza cookie, PIN o accesso diretto al database. La scadenza del token non
supera quella del mandato. Revoca e blocco manuale impediscono nuovi depositi.

Tutti i comandi accettano `--credenziali /percorso/privato` per scegliere la
cartella delle credenziali e dello stato di ripresa. Usare la stessa cartella
per tutto il collegamento e per i depositi successivi. La cartella deve essere
privata (0700), fuori da Documenti, Scrivania e dalle cartelle cloud.

## Depositare e riprendere

Preparare `estrazione-preparata.json` nel formato
`mediflow.dossier_prepared_extraction.v1`. Il client riusa fatti, citazioni,
nomi dei PDF ed hash già presenti nel file. I PDF devono trovarsi accanto
all’estrazione ed avere gli hash dichiarati. La trascrizione è facoltativa.

Prima del primo tentativo, il chiamante assegna alla visita un UUID e lo salva
nel proprio stato. Lo stesso UUID identifica ogni ripresa della stessa visita.

```sh
npm run agent:visita -- deposita --agente UUID-AGENTE --estrazione /visita/dossier/estrazione-preparata.json --cf - --visita UUID-VISITA
npm run agent:visita -- riprendi --agente UUID-AGENTE --visita UUID-VISITA
```

Con `--cf -` il client legge il CF da stdin fino alla chiusura dello stream,
senza inserirlo negli argomenti del processo.

Aggiungere `--trascrizione /visita/trascrizione.txt` se presente. Dopo una
risposta persa o un’interruzione, `riprendi` riusa le buste cifrate già salvate.
Cambiare file o identità richiede una nuova visita, anziché riusare il suo UUID.
Il client rifiuta file SQLite, link simbolici e PDF con hash diversi.

La ricevuta `closed` conferma che la visita è stata depositata nella cassetta
cifrata. Quando la scheda è sbloccata, MediFlow controlla le visite in attesa
e verifica che il codice fiscale dei PDF coincida con un’unica scheda.
I CF discordanti, mancanti o ambigui bloccano la visita.

In «In arrivo» puoi leggere nota e trascrizione, aprire i PDF, confrontare i
dati della scheda con le proposte e applicare una visita o tutte quelle senza
dubbi. Nulla della visita entra in cartella prima di questo gesto o della
conferma nativa.

## Trasporto MCP

```sh
npm run agent:mcp -- --credenziali /percorso/privato
```

Il processo comunica su standard input/output. Espone `mediflow_collega`,
`mediflow_completa_collegamento`, `mediflow_ritira_mandato`, `mediflow_deposita_visita` e
`mediflow_riprendi_visita`. CLI e MCP chiamano lo stesso client, con gli stessi
permessi e ricevute. Standard output contiene soltanto il protocollo MCP.


## Conferma di una singola visita su macOS

Nel profilo Mac di prova, l'istanza locale va avviata con il riquadro nativo
firmato e con una scheda Web sbloccata sullo stesso archivio. Il componente
si compila da `native/AgentVisitConfirmation`. Chi prepara la distribuzione
firma l'eseguibile con Hardened Runtime e identificatore
`com.mediflow.agent-visit-confirmation`, poi configura nel runtime proprietario
`MEDIFLOW_VISIT_CONFIRMATION_HELPER` con il percorso assoluto e
`MEDIFLOW_VISIT_CONFIRMATION_HELPER_SHA256` con lo SHA-256 successivo alla firma
e `MEDIFLOW_VISIT_CONFIRMATION_HELPER_CDHASH` con il valore `CDHash` della firma
macOS. Il proprietario della scrittura verifica la firma del processo
all'apertura del canale e quando riceve la conferma.

Dalla chat, `mediflow_apri_conferma_visita` riceve il `visitId`.
Quando MediFlow mostra il piano, controlla il paziente e le proposte, poi
seleziona «Conferma la visita» per Touch ID o Apple Watch. «Usa la password
del Mac» apre il dialogo di sistema con un vincolo sulla password dell'account.
MediFlow valuta il vincolo `devicePasscode` con LocalAuthentication e riceve l'esito.
Il server MCP del plugin usa il collegamento della visita depositata.
`mediflow_esito_conferma_visita` riceve il visitId e il `reference` restituito
dalla prima chiamata. Il server generico e la CLI usano l'identificativo
dell'agente. Gli esiti sono `waiting`, `applied`, `not_applied`
e `unavailable`. Se il riquadro è indisponibile, riprendi da «In arrivo».

CLI equivalenti:

```sh
npm run agent:visita -- apri-conferma --agente UUID-AGENTE --visita UUID-VISITA
npm run agent:visita -- esito-conferma --agente UUID-AGENTE --riferimento UUID-CONFERMA
```
