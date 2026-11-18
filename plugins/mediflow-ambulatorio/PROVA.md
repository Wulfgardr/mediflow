# Prova sintetica del plugin in Codex CLI

18 novembre 2026. macOS arm64, Node 24.22.3, Codex CLI 0.169.0-alpha.11.1. La prova usa l'app standalone con un archivio inizialmente vuoto, Chromium in sandbox con rete limitata al loopback e una cartella di lavoro senza progetto. Marketplace e plugin sono stati aggiunti con `codex plugin marketplace add` e `codex plugin add` in una `CODEX_HOME` temporanea. Anche l'archivio locale del plugin, le credenziali e i Download di prova sono isolati.

L'API Responses di prova è un trasporto scriptato su loopback. Codex CLI esegue le chiamate MCP scelte dal trasporto. La prova non misura la capacità di un modello remoto di seguire la skill. Lo script controlla che Codex veda la skill installata e che il server e gli strumenti provengano dal plugin.

| Gesto | Esito osservato |
| --- | --- |
| «Collega MediFlow» | Codex ha chiamato `mediflow_collega`. MediFlow ha mostrato lo stesso codice e la pagina Agenti ha approvato l'abbinamento. |
| «Fatto» nella chat di collegamento | `mediflow_completa_collegamento` ha restituito `approved`. |
| «Visita…» in una nuova chat | `mediflow_acquisisci_visita` ha ricevuto il dettato integrale. Il PDF con CF paziente e CF del medico etichettato è stato ammesso. Il PDF con due CF paziente è rimasto escluso. |
| «Fine visita» nella stessa chat | `codex exec resume` ha ripreso lo stesso thread. `mediflow_prepara_dossier` ha restituito zero rifiuti. `mediflow_deposita_visita` ha restituito `closed`, cinque elementi e una proposta di terapia. Nessuno dei turni ha eseguito comandi shell. |
| Scheda MediFlow sbloccata | Due voci di diario (nota e trascrizione), due PDF (nota e originale abbinato), zero terapie applicate. «In arrivo» mostrava la proposta. |

La regressione automatica esercita anche il CF candidato non confermato, il CF del medico, i ruoli contraddittori nello stesso PDF, la citazione inventata, il rifiuto prima della verifica e il retry dopo una risposta persa. Dopo il retry c'è una sola cassetta chiusa e le richieste di deposito non contengono il CF, il dettato, la citazione o il token in chiaro.

Il controllo delle cartelle è stato provato con una destinazione sincronizzata fittizia e con un alias simbolico che puntava alla stessa cartella. Entrambe le configurazioni sono rifiutate prima della prima scrittura.
