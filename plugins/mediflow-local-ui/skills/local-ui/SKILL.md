---
name: local-ui
description: Apri ricerca, anagrafica, storia o guida prescrittiva nella UI locale separata di MediFlow, senza ricevere dati del paziente.
---

Usa `mediflow.local_ui.navigate.v1` con un solo intento: `search`, `identity`,
`history`, `prescribing`. Per aprire MediFlow usa `search`, anche prima del
login. Non chiedere né inserire nomi, codice fiscale, identificativi, storia,
URL o prove negli argomenti. Il medico effettua accesso, ricerca e selezione
in MediFlow e conferma la vista sulla cartella locale aperta.

La risposta `continue_in_mediflow` invita a proseguire nella UI. Non prova
che sia apparso un paziente, una vista o una ricetta. Non dichiarare dati
consultati, scritture, firme o trasmissioni. Non puoi rispondere con CF o storia
né ragionare su dati che questo canale non riceve. La guida distingue farmaco,
prestazione e protesica: la decisione e gli atti restano al medico nella UI.

Se il tool è assente o negato, riferisci che il percorso plugin non è
disponibile e invita a usare MediFlow direttamente. Non cercare ripieghi
tramite DB, file, shell, browser, screenshot o altri strumenti dell'host.
