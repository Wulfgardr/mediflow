# Catture Apple, 7 novembre 2026

App Debug sul banco sintetico, codice `d33e42e7bedc896fd21d40baea767367ff77eab1`. iPhone 17 Pro ed iPad Pro 13 pollici su iOS 27.3. iPad orizzontale. Questi cinque PNG sono una selezione delle 28 catture automatiche del giro Apple, senza elaborazione delle immagini.

| Schermata | Evidenza |
| --- | --- |
| [Elenco iPad](ipad-elenco-giorno.png) | Barra laterale con sei aree e righe da 44 punti. |
| [Scheda iPad](ipad-scheda-giorno.png) | Quattro tabelle nel quadro e diario affiancato. |
| [Impostazioni Grafite](ipad-impostazioni-grafite.png) | Inchiostro sul fondo selezionato, senza blu pieno. |
| [Scrittura iPhone](iphone-scrittura-grafite.png) | Soglia di registrazione visibile sopra la tastiera. |
| [Errore PIN Grafite](iphone-errore-grafite.png) | Croce e critico pieno. |

`CaptureTests.swift` verifica la presenza delle quattro tabelle, l'assenza dell'annuncio di apertura dal testo visibile, la riga iPad di 44 punti, il contenimento della prosa ed il bordo inferiore della soglia rispetto al bordo superiore della tastiera.

L'autore non è nel DTO del diario: la riga resta «Registrata». Il componente allergie accetta un parametro vuoto di default, senza ricavare dati dalle note. Mac verificato con build, senza nuove catture desktop. VoiceOver reale, dispositivo fisico ed uso clinico non provati.
