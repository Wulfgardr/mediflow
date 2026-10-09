---
summary: "Disegno dell'ascolto della visita in Punto d'inchiostro: posizione del microfono, stati, testi e rapporto con ADR 0113."
read_when:
  - "Lavorando sul comando del microfono, sulla trascrizione o sulla loro revisione."
  - "Valutando se estendere l'ascolto oltre il Mac."
---

# Ascolto della visita

## Che cosa è già deciso

Il modello per trascrivere la visita non è da scegliere adesso: è deciso da
[ADR 0113](../../adr/0113-recording-visita-trascrizione-locale-085.md),
accettato il 1 settembre 2026, sul confine fissato da
[ADR 0072](../../adr/0072-voice-visit-capture-fluid-boundary.md).

- Solo l'app Mac, da macOS 26, con la trascrizione di sistema in italiano
  eseguita sul computer.
- L'audio non viene mai salvato: nessun file, nessuna colonna, nessun invio.
- La trascrizione è una proposta. Non scrive in cartella.
- Un passaggio di informativa precede la richiesta del permesso.
- Durata massima 90 minuti, trascrizione massima 256 KiB.
- Nessun ripiego verso servizi esterni o altre lingue.

Il codice esiste: `AppleVisitRecordingRuntime.swift` e
`VisitRecordingLumeShell.swift`. Questo documento decide come quella funzione
si presenta nella nuova direzione. Non cambia la pipeline.

## Dove sta il microfono

**Dentro la voce in scrittura, nella riga di stato, a destra.**

- Non è un comando globale: l'ascolto appartiene a una voce di un paziente, e
  metterlo lì rende evidente a chi verrà attribuito.
- Non sta nella soglia: la soglia è il posto di "Registra", che scrive in
  cartella. Due comandi con significati così diversi non stanno affiancati.
- Durante l'ascolto il comando resta nello stesso punto e diventa "Ferma
  l'ascolto". Chi ha avviato sa dove fermare senza cercare.
- Su iPhone, quando la funzione ci sarà, stessa posizione, con bersaglio da
  44 pt.
- Dove l'ascolto non è disponibile il comando non compare. Non si mostra un
  comando spento senza spiegazione; la spiegazione sta in Impostazioni,
  Funzioni AI.

Il comando porta icona del microfono e parola. L'icona da sola non basta.

## La parola

Oggi l'app Mac dice "Registrazione visita" e "Avvia registrazione". Nella
nuova direzione "Registra" è il comando che scrive in cartella. Due
significati per lo stesso verbo, nella stessa schermata, sono un rischio.

**Deciso da Leonardo il 9 ottobre 2026:** l'audio si "ascolta". Comando
"Ascolta la visita", stato "In ascolto", arresto "Ferma l'ascolto". I testi
dell'app Mac vanno allineati quando l'interfaccia viene adeguata (WUL-768).

## Come si lega ai tre inchiostri

Ciò che viene dal microfono è prodotto da un modello, quindi arriva **a
matita**. Diventa inchiostro fresco quando il medico lo porta nella voce o lo
modifica. Diventa inchiostro asciutto solo passando dalla soglia, come ogni
altra scrittura. Il permesso del microfono non vale come conferma di
scrittura.

## Stati

Gli stati sono quelli della macchina di ADR 0113; qui hanno aspetto e testo.
Il pannello dell'ascolto si apre dentro la voce viva, sotto l'area di testo.

| Stato (ADR 0113) | Che cosa si vede | Testo | Comandi |
| --- | --- | --- | --- |
| `unavailable` | Il comando non compare | In Impostazioni: "L'ascolto non è disponibile su questo computer. Puoi scrivere la voce a mano." | nessuno |
| `disclosure` | Informativa | "L'audio viene elaborato solo su questo computer e non viene salvato. La trascrizione arriva a matita: resta una proposta finché non la porti nella voce. Informa il paziente prima di cominciare." | Annulla, Consenti microfono e continua |
| `preparingAssets` | Avanzamento del sistema | "La lingua italiana non è installata. Lo scaricamento parte solo con il comando seguente." | Installa la lingua italiana |
| `ready` | Conferma di prontezza | "Microfono e lingua italiana sono pronti. L'avvio resta manuale. Durata massima 90 minuti." | Annulla, Ascolta la visita |
| `recording` | Punto vuoto che respira, tempo in mono, livello del microfono | "In ascolto mm:ss" e "Solo su questo computer · audio non salvato" | Ferma l'ascolto |
| `finalizing` | Punto vuoto fermo | "Trascrizione in corso…" | nessuno |
| `transcriptReview` | Area di testo a matita, bordo tratteggiato, contatore | "Trascrizione da rivedere" e "Ciò che porti nella voce diventa inchiostro fresco e passa comunque dalla conferma." | Scarta la trascrizione, Porta nella voce |
| `completed` | Riga di stato in inchiostro fresco | "Trascrizione portata nella voce. Rivedila prima di registrare." | Nuovo ascolto |
| `denied` | ✕ critico | "Accesso al microfono negato. L'ascolto è chiuso e non verrà ritentato." | Chiudi, Apri le impostazioni del microfono |
| `staleBinding` | ▲ avviso | "Il paziente o la scheda sono cambiati. La trascrizione è stata scartata." | Chiudi |
| `interrupted`, `bufferExceeded`, `failed` | ✕ critico | "L'ascolto si è interrotto. La trascrizione non è completa ed è stata scartata." | Chiudi, Nuovo ascolto |

Durante `recording`:

- la soglia mostra "In ascolto mm:ss" con il punto che respira e il comando
  "Registra" è disattivato, con la riga "Ferma l'ascolto prima di
  registrare";
- l'indicatore resta visibile anche scorrendo, perché la soglia non scorre;
- cambiare paziente, bloccare o chiudere la finestra ferma l'ascolto e scarta
  l'audio, come già fa il controller;
- con la riduzione del movimento il punto è fermo e resta la parola.

Se la voce contiene già testo e si porta una trascrizione, vale la scelta che
l'app fa oggi: "Mantieni entrambi" oppure "Sostituisci il testo", con la
seconda come azione distruttiva.

Il banco mostra il flusso: schermata "Ascolto della visita", piattaforma
macOS. Con "Simula errore" si vede il permesso negato.

## Oltre il Mac

Windows, Linux, iPhone, iPad e web non hanno oggi l'ascolto. Estenderlo
richiede decisioni che questo dossier non prende:

- quale modello locale, misurato su dettato clinico italiano sintetico;
- se i client collegati possono catturare audio, cosa che ADR 0113 oggi
  esclude;
- consenso del paziente e perimetro d'uso.

La valutazione è in
[WUL-772](https://linear.app/wulfgardr/issue/WUL-772). Il disegno qui sopra
vale per qualunque piattaforma la ottenga: stessa posizione, stessi stati,
stesse parole.

## Che cosa non fare

- Avviare l'ascolto senza un gesto esplicito.
- Mettere il microfono in una barra globale o accanto a "Registra".
- Mostrare la trascrizione nello stesso colore della bozza.
- Scrivere in cartella una trascrizione senza passare dalla soglia.
- Usare il rosso per l'indicatore di ascolto: il rosso è un segnale clinico.
- Conservare l'audio "per sicurezza".
