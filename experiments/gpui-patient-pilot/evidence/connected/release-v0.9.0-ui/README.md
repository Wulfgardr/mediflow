# Schermate storiche della release v0.9.0

Questi 11 PNG sono gli originali estratti dall’artefatto `playwright-report`
**11998142170**, prodotto dal [run E2E 38783064909](https://github.com/Wulfgardr/mediflow/actions/runs/38783064909)
il 15 ottobre 2026. Sono schermate della reale applicazione su archivi sintetici;
non sono nuovi rendering, mockup o catture effettuate durante la migrazione.

Il run si riferisce al commit della release
`9c7b3adf2eb18551b7c03b61e0fa6ee2303d31d0` e ha eseguito il merge di PR
`8e0a4e9bde7cc2d115c627cd5f25142091aa1b8d`. Le API dei due commit confermano
lo stesso albero Git: `13a1cf283dc18dbf06a0dad3f55d48f741e326e7`.

[manifest.json](manifest.json) registra percorso originale nell’archivio, SHA256,
dimensioni, viewport, test, esito, sorgente del test e stato visualizzato per ogni
PNG. Il digest dell’archivio scaricato coincide con quello pubblicato da GitHub.
I PNG conservano esattamente i byte originali; il sottoinsieme occupa 912.678 byte.
Il report completo, video, log e materiale di recupero non sono inclusi.

| Superficie | Desktop | Telefono |
| --- | --- | --- |
| Elenco pazienti, dopo navigazione da tastiera | [1440 × 900](patient-list-desktop.png) | [390 × 844](patient-list-phone.png) |
| Quadro clinico, tema chiaro | [1440 × 960](patient-quadro-light-desktop.png) | [390 × 844](patient-quadro-light-phone.png) |
| Quadro clinico, tema scuro | [1440 × 960](patient-quadro-dark-desktop.png) | [390 × 844](patient-quadro-dark-phone.png) |
| Cartella con voce di diario registrata | [1440 × 960](patient-diary-desktop.png) | [390 × 844](patient-diary-phone.png) |
| Nuova voce clinica | [1440 × 960](new-entry-desktop.png) | [390 × 844](new-entry-phone.png) |
| Impostazioni del profilo | [1440 × 960](settings-profile-desktop.png) | — |

Tutti i test associati alle immagini selezionate risultano `passed`, senza retry.
Il report `official-ui` contiene sei prove riuscite su un runtime production
dedicato; quelle prove sono intenzionalmente saltate nel report principale.

Le fixture storiche sono diverse dal corpus del confronto con Rust. Le immagini
servono a confrontare gerarchia, tipografia, navigazione e disposizione; non
attestano parità pixel per pixel o parità funzionale sul medesimo archivio.
Lo scroll e il focus sono quelli lasciati dai test: alcune porzioni della
cartella rimangono fuori dal viewport. I temi del Quadro sono impostati tramite
il contratto CSS/storage dell’applicazione. Non sono una prova del gesto utente
che cambia tema, né una verifica visiva nuova del client GPUI.
