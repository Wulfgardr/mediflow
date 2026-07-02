# Prompt pronto per Gemini (Antigravity)

Da incollare in Antigravity con il repo medical-record-app aperto (la CLI gemini standalone e bloccata da licenza). Scopo: seconda opinione INDIPENDENTE e adversariale sull'orizzonte strategico, con angolo diverso da quello gia coperto da Codex (che ha fatto l'indagine ecosistema/standard/OSS con citazioni web).

---

Sei un revisore strategico esterno, scettico e competente in sanita digitale e software open source. Leggi questi file del repo:
1. docs/analysis/2026-07-02-orizzonte-mediflow-1-2-5-anni.md (la lettura prospettica da criticare)
2. README.md e docs/adr/0065-intended-purpose-and-claims-guard.md (gli intenti dichiarati)
3. docs/ROADMAP.md (lo stato)

Contesto: MediFlow e una cartella clinica local-first open source (MIT) per assistenza primaria e medicina di prossimita, con vocazione altruistica esplicita (adottabile senza soldi ne infrastruttura, anche in contesti a basse risorse). L'AI e locale, assistiva, review-first per ADR. Il cloud non e mai un requisito.

Il tuo compito NON e rifare l'indagine di mercato (gia fatta da altri). E stressare la LETTURA STRATEGICA:

1. FALSIFICAZIONE: per ciascuno dei tre orizzonti (1, 2, 5 anni) indica il modo piu probabile in cui quella scommessa FALLISCE nel mondo reale (adozione, non tecnologia). Sii specifico: chi e l'utente che non arriva, quale attrito lo ferma.
2. PRIORITA CONTESTATE: il documento mette la distribuzione tri-OS (F1) prima di tutto e promuove la sostenibilita (F6) a frontiera di pari rango. Argomenta il MIGLIOR caso contrario: esiste un ordine piu saggio? C'e una frontiera mancante o una di troppo?
3. LOW-RESOURCE REALITY CHECK: la sezione 5 anni immagina l'adozione in contesti a basse risorse (hardware vecchio, connettivita a singhiozzo, lingue multiple). Elenca i 5 ostacoli concreti che l'esperienza di progetti come OpenMRS/DHIS2 in quei contesti ha mostrato e che il documento sottovaluta o ignora (es. formazione, manutenzione locale, alimentazione, turnover del personale, dati di popolazione vs dati individuali).
4. RISCHIO REGOLATORIO MINIMO VITALE: senza spingere verso la rincorsa alle certificazioni (anti-obiettivo dichiarato), qual e il MINIMO regolatorio UE che un software del genere fara bene a presidiare nei prossimi 2 anni per non trovarsi un muro davanti (MDR software classification? EHDS obblighi per EHR systems? GDPR gia coperto?). Distingui cio che si applica a un tool locale senza vendor cloud da cio che non si applica.
5. TRE MOSSE: se potessi imporre solo tre decisioni al progetto per il prossimo anno, quali e perche.

Formato: markdown conciso, sezioni numerate come sopra, niente trattino lungo, ogni affermazione fattuale marcata FATTO o OPINIONE. Non modificare file.
