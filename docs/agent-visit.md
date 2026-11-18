# Deposito della visita da un client agente

Il client deposita una visita cifrata nella cassetta di MediFlow. La ricevuta
conferma il deposito. La scheda Web sbloccata verifica l’identità nei PDF ed
inserisce nota, trascrizione e PDF quando coincidono con il codice fiscale
di un’unica scheda esistente. Terapie, prestazioni, diagnosi, esenzioni ed
osservazioni restano in «In arrivo» per la revisione del medico.

Il contratto è [ADR 0190](./adr/0190-mandato-agenti-e-cassetta-della-visita.md).
Il client richiede Node 24 e le dipendenze della checkout. I comandi seguenti
si eseguono dalla radice della repository.

## Collegare il client

In MediFlow, sbloccare con la passphrase, aprire Impostazioni, Agenti e creare
un mandato di dodici ore. Il PIN conferma il mandato, che indica operazioni,
fornitore del modello e autorizzazione ad inviare dati clinici al fornitore.

```sh
npm run agent:visita -- collega --origine http://127.0.0.1:3000 --nome "Fine visita"
```

Usare l’origine dell’istanza locale aperta. Il comando restituisce `requestId`
e `code`. Confrontare il codice nella pagina Agenti ed approvarlo, poi eseguire:

```sh
npm run agent:visita -- completa --richiesta UUID-DELLA-RICHIESTA
```

Conservare `agentRef` dalla ricevuta. Dal prossimo sblocco con passphrase il
client registrato può ritirare il mandato di 12 ore. Il blocco, la scadenza
della sessione o la revoca in Agenti interrompono l’accesso.

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
cifrata. Dopo lo sblocco con passphrase, MediFlow controlla le visite in attesa
e inserisce nota, trascrizione e PDF con codice fiscale coincidente con la scheda.
I CF discordanti, mancanti o ambigui bloccano l’applicazione automatica.

In «In arrivo» puoi confrontare i dati della scheda con le proposte, leggere
il PDF originale e applicare una visita o tutte quelle senza dubbi. Le proposte
cliniche richiedono la tua conferma.

## Trasporto MCP

```sh
npm run agent:mcp -- --credenziali /percorso/privato
```

Il processo comunica su standard input/output. Espone `mediflow_collega`,
`mediflow_completa_collegamento`, `mediflow_ritira_mandato`, `mediflow_deposita_visita` e
`mediflow_riprendi_visita`. CLI e MCP chiamano lo stesso client, con gli stessi
permessi e ricevute. Standard output contiene soltanto il protocollo MCP.
