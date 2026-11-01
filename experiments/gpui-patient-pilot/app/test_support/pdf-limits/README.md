# Limiti documentati della guardia PDF

Dati sintetici: entrambi i file conservano il codice della cifra 3 e ToUnicode,
ma il mapping CID oppure cmap la associa al glifo zero. Il helper li accetta e
produce pixel bianchi. Non sono casi rifiutati e non rientrano nei 30 PDF legittimi
del precedente confronto. Il test conserva questo esito osservato; l'avviso e il
salvataggio sono verificati nel renderer della vista PDF accettata.

La guardia copre i nomi Differences usati, non ogni glifo. La mitigazione è
l'avviso sempre visibile e la possibilità di salvare l'originale. Non aggiunge
una verifica di cmap o CIDToGIDMap e non garantisce la fedeltà di ogni valore.
