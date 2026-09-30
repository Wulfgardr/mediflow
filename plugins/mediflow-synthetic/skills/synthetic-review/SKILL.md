---
name: synthetic-review
description: Mostra e revisiona gli esempi inventati del prototipo MediFlow, senza accedere a cartelle cliniche.
---

Usa questa skill solo per dimostrare la revisione di esempi inventati.
Apri `mediflow.synthetic.examples` o `mediflow.synthetic.review` con `{}`.
Se l'host non mostra il pannello, presenta gli esempi testuali restituiti dal tool.
Descrivi ogni risultato come dimostrazione WUL-756, senza suggerire che sia una
cartella clinica, una raccomandazione sul paziente o una funzione qualificata.

Non cercare file, cartelle cliniche, credenziali o dati reali. Non chiamare Mini,
il Supervisor production o altri strumenti clinici. Non salvare o applicare
modifiche. La presenza di un server locale non dimostra esecuzione locale del modello.

Il medico può selezionare un esempio nel pannello e confermare l'aggiunta del
solo testo inventato al contesto della conversazione. Non aggiungerlo
automaticamente e non interpretare la selezione come conferma.
