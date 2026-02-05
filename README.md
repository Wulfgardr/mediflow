# 🏥 MediFlow v0.3.0

> **Una cartella clinica fatta da un medico, per i medici.**
> Funziona offline, rispetta la privacy, usa l'AI in locale. Niente cloud, niente abbonamenti, niente sorprese.

---

## 👋 Ciao

Mi chiamo **Leo**, sono un medico di distretto (Community Care) italiano.
Ho costruito MediFlow perché ero stanco. Stanco di software lenti, stanco di dover avere internet per guardare una pressione, stanco di non sapere dove finiscono i dati dei miei pazienti.

Volevo qualcosa di **veloce, bello e blindato**.
Così l'ho programmato.

## 🌟 Perché MediFlow?

1. **I Dati sono TUOI**: Tutto vive sul tuo Mac, in un singolo file cifrato. Se stacchi internet, funziona uguale.
2. **Privacy Totale**: Usiamo crittografia militare (AES-256). Senza il PIN, nemmeno io posso leggere i tuoi dati.
3. **Intelligenza Artificiale, ma Privata**: Ho integrato modelli AI (come DeepSeek e MedGemma) che girano *dentro* il tuo computer. Leggono i PDF, fanno l'OCR dei referti e ti danno sintesi cliniche senza mai inviare un solo byte a server esterni.
4. **Semplice**: L'interfaccia non sembra un software degli anni '90. È pulita, moderna e pensata per chi lavora.

---

## 📚 Documentazione

Ho riorganizzato tutto per non farti perdere tempo. Scegli la tua strada:

### 🩺 Per il Medico

Vuoi solo sapere come installarlo, come si usa e come gestire i pazienti?
👉 **[Leggi il MANUALE OPERATIVO](docs/MANUALE.md)**
*(Include: Installazione, Primo Avvio, Gestione Pazienti, FAQ)*

### 🛠 Per lo Sviluppatore / Nerd

Vuoi capire come gira sotto il cofano, vedere il codice, o modificare l'app?
👉 **[Leggi l'ARCHITETTURA](docs/ARCHITETTURA.md)**
*(Include: Stack Next.js, Crittografia, Docker, AI Pipeline)*

### ⚖️ Compliance & Privacy

GDPR, sicurezza dei dati e interoperabilità (FHIR R4).
👉 **[Leggi COMPLIANCE](docs/COMPLIANCE.md)**

### 🍏 Per chi vuole l'App Nativa

Stiamo costruendo un client nativo per macOS (SwiftUI) per un'esperienza ancora più integrata.
👉 **[Leggi la GUIDA NATIVE](docs/NATIVE.md)**

### 🗺 Il Futuro

Dove stiamo andando? Cosa arriverà dopo?
👉 **[Guarda la ROADMAP](docs/ROADMAP.md)**

---

## 🚀 Installazione Rapida (Docker)

Se sai cos'è Docker, ecco il riassunto brutale:

```bash
# 1. Clona
git clone https://github.com/tuouser/mediflow
cd mediflow

# 2. Avvia
./Start_MediFlow.command
```

Vai su `http://localhost:3000`. Finito.
*La prima volta ci metterà un po' a scaricare i modelli AI.*

---

## ⚖️ Note Legali & GDPR

Questo è un progetto open source rilasciato con licenza MIT.
È pensato per essere **Privacy by Design**, ma l'uso in ambiente clinico reale richiede che tu faccia le tue valutazioni di conformità (DPIA, ecc.) come Titolare del Trattamento.

**I dati non lasciano mai il tuo dispositivo.** Questa è la garanzia tecnica. La garanzia legale la costruisci tu usandolo con responsabilità.

---

*Fatto con ❤️ (e tanta caffeina) in Italia.*
