# Impostazioni: prove residue della 0.9.1

Refs WUL-787. Chromium, produzione standalone, Node 24.18.0 ABI 137,
loopback porta 3000, archivio sintetico dedicato. Nessun dato clinico reale.

Base: `dad877af34028b579894e301e1d69ff947263c1a` (`origin/main`).
Le acquisizioni della base usano gli stessi test aggiuntivi del candidato.
Le prove delle PR precedenti sono riusate per gli stati già qualificati.

| Riga | Prova riusata | Integrazione mirata |
| --- | --- | --- |
| W-18a Backup | #666, prodotto 4908f242, 72+72 frame; #694 per le conferme comuni | Avviso completo al 400% mediante scorrimento, controllo delle singole righe, parola di conferma e annullamento nei due temi. |
| W-19b Profilo | #669, prodotto 2cb07eb, guardia e galleria c021 | Ritorno browser e blocco: difetto riprodotto sulla base, bozza in memoria vincolata ad account e generazione archivio; rilettura obbligatoria prima di salvare. |
| W-19e Compliance | #670, prodotto 1588d668, titoli e disclosure | Dettagli delle sei evidenze nei due temi e sei dimensioni. |
| W-19f Diagnostica | #670, prodotto 1588d668, controlli e rilettura 503 | Messaggi WHO, controlli non eseguiti/in corso/riusciti/falliti, aggiornamenti nei due temi e sei dimensioni. |
| W-19k Fabric | #678, prodotto b862, letture e supplemento 400% | Ingressi dal redirect /settings/ai per tutti i sei stati, 1440/768/390/200% nei due temi. |
| W-19l Governance | #678, prodotto b862, letture e tastiera | Quattro stati a 1440/768/390/200% nei due temi. |
| W-20c Repertori | #676, prodotto f660, letture e zero osservato | Panoramica, selezione cataloghi da tastiera, zero e letture fallite nelle dimensioni mancanti. La panoramica corrente ha selezione dei cataloghi, senza un filtro testuale separato. |

Il flusso di backup e recupero non cambia. Nessun ripristino eseguito:
la POST è intercettata e vietata. Al 400% il testo supera l'area utile:
le catture consecutive attestano la lettura integrale, non un singolo frame.

La bozza Profilo resta soltanto nella memoria del documento browser. Il blocco
smonta la pagina e nasconde i campi; lo sblocco rilegge il profilo, riprende
la bozza soltanto per lo stesso account e archivio e disabilita Salva fino
alla rilettura esplicita. Abbandono confermato e stato salvato eliminano la bozza.
Ricaricamento completo e chiusura del browser non sono persistenza della bozza.
Non cambiano writer, versioni opache, autenticazione o trasporto.

Esiti finali, ricevute, hash delle immagini e limiti sono aggiunti dopo la verifica.

Sviluppo assistito: GPT 6.1 Sol, effort High, senza delega. Rilavorazioni:
guardie dei vecchi spec adattate alla porta 3000 richiesta; prove aggiuntive
separate dalle coperture già valide. Consumi non attribuibili.
