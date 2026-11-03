---
name: local-ui
description: Apri ricerca, anagrafica, storia o guida prescrittiva nella UI locale separata di MediFlow, senza ricevere dati del paziente.
---

Il server MCP pubblica `mediflow.local_ui.navigate.v1`. Invocalo attraverso
il nome esposto dal client, con un solo intento: `search`, `identity`,
`history`, `prescribing`. Per aprire MediFlow usa `search`, anche prima del
login. Non chiedere né inserire nomi, codice fiscale, identificativi, storia,
URL o prove negli argomenti. Il medico effettua accesso, ricerca e selezione
in MediFlow e conferma la vista sulla cartella locale aperta.

In Codex CLI puoi richiamare esplicitamente la skill del plugin installato
con `$mediflow-local-ui:local-ui` nel messaggio. Verifica la presenza del tool
nel turno: l'installazione e `codex mcp list` descrivono la configurazione,
mentre `ALL_TOOLS` mostra gli strumenti disponibili per l'invocazione.

In Codex con code mode, il tool può essere differito: cercalo in `ALL_TOOLS`
da `functions.exec`, poi usa il nome restituito sull'oggetto `tools`:

```javascript
const tool = ALL_TOOLS.find(t => /mediflow.*local_ui.*navigate/u.test(t.name));
if (!tool) throw new Error('Tool MediFlow non disponibile in questa sessione');
text(await tools[tool.name]({ intent: 'search' }));
```

Per gli altri intenti cambia soltanto il valore di `intent`. Codex 0.166
espone questa funzione come
`tools.mcp__mediflow_local_ui__mediflow_local_ui_navigate_v1`.
Il nome MCP con i punti non è il nome della funzione JavaScript.
La presenza in `ALL_TOOLS` consente di scoprire anche i tool differiti;
non disattivare il code mode per invocarli. Negli altri client usa il tool
MCP esposto dal client stesso.

La risposta `continue_in_mediflow` invita a proseguire nella UI. Non prova
che sia apparso un paziente, una vista o una ricetta. Non dichiarare dati
consultati, scritture, firme o trasmissioni. Non puoi rispondere con CF o storia
né ragionare su dati che questo canale non riceve. La guida distingue farmaco,
prestazione e protesica: la decisione e gli atti restano al medico nella UI.

Se il tool è assente o negato, riferisci che il percorso plugin non è
disponibile e invita a usare MediFlow direttamente. Non cercare ripieghi
tramite DB, file, shell, browser, screenshot o altri strumenti dell'host.
