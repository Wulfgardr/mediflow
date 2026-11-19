# ADR 0197 · Prova del client per la sessione Web

Stato: Proposed.

La sessione Web richiede una prova casuale di 256 bit oltre ai riferimenti di sessione e controllo. L’app Web la genera quando apre il documento e la invia nelle richieste API alla propria origine. GPUI conserva una prova separata per ciascuna autorità Web locale. Il server associa la prova alla coppia di sessione e controllo quando l’accesso riesce o quando una scheda già autorizzata conferma il rinnovo richiesto da una seconda. Il server conserva in memoria solo la sua impronta e la ritira insieme alla sessione.

Il proprietario Web P3 conserva il controllo su ruolo, durata, lock e logout. Il controllo della generazione dell’archivio continua a valere. Le API versionate mantengono le proprie credenziali per accesso locale e dispositivi abbinati.

La prova vive quanto il documento Web. In una scheda ricaricata o appena aperta il medico può usare «Rinnova accesso» se ha ancora una scheda sbloccata. La scheda nuova genera la propria prova. Il rinnovo autorizza una singola accettazione per dieci secondi. Il blocco o il logout ritirano tutte le prove legate alla sessione, comprese le autorizzazioni di rinnovo ancora in corso.

Dopo il riavvio del server serve accedere di nuovo. Dopo l’aggiornamento le sessioni precedenti richiedono un nuovo accesso. L’archivio conserva formato, dati e credenziali correnti. Per le operazioni Web di GPUI, aggiornare insieme server e client.
