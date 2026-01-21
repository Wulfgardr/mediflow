# MediFlow (Presentation)

Hello there! My name is Leo, I am a physician from Italy and I work in the Community Care setting. The idea of managing patient data, therapies, and clinical notes without relying on internet connectivity or third-party cloud services is what led me to create MediFlow.

MediFlow is a comprehensive, local-first medical record management system designed for **reliability**, **privacy**, and **speed**. It empowers medical professionals and allows to shift the focus from managing IT issues to patient care.

The software "base" is in Italian but feel free to branch, modify, suggest and so much more. I am a newbie in the development world and I am always open to learning and improving. Don't forget that this application is made from the Italian point of view (AIFA for medication references, etc.) and many features and upcoming changes are tied to my everyday clinical practice. Yet this product is made with modularity in mind. Feel free to reach out for any suggestions! Open Source for the win!

![MediFlow Screenshot](screenshot.png)

## Core Philosophy

* **🔒 Privacy First**: Your patient data never leaves your device unless you explicitly export it. We use IndexedDB for robust, encrypted-at-rest local storage.
* **⚡ Speed & Fluidity**: Built with a "Zero-Lag" philosophy. Every interaction is immediate, thanks to the local-first architecture.
* **🏥 Clinical Effectiveness**: Tools designed by doctors, for doctors. From smart ICD-11 coding to automatic PDF therapy printing.

---

## Technical Documentation (ReadMe)

## 🛠 Tech Stack

* **Framework**: Next.js 15 (App Router)
* **Styling**: Tailwind CSS v4 (with custom "Liquid Glass" aesthetics)
* **Database**: Dexie.js (IndexedDB)
* **AI Engine**: Local LLM integration via **Ollama** or remote OpenAI fallback.

## ⚙️ Logic & Architecture

### 1. Data Management

The application runs entirely in the browser.

* **Patients & Entries**: Stored in `Dexie` (IndexedDB).
* **Files**: Attachments are chunked and stored as Blobs locally.
* **Drug Database**: Uses the AIFA Open Data standard. The OSS version requires you to upload the `confezioni.csv` manually.

### 2. AI Integration

* **Ollama (Local)**: Recommended for privacy. We support `medgemma` and `llama3` models.
  * *Setup*: Run `ollama serve` on port 11434.
* **Structure**: The `ai-engine.ts` handles the prompt construction and context window management.

### 3. ICD Classification

* **ICD-9**: Built-in JSON lookup.
* **ICD-11**: Requires a local Docker container of the WHO API for full functionality/offline support, or uses the public API with an API key.

## 📦 Patch Notes

### **v0.2.0 - "The Polished Update"**

* **🎨 Dark Mode Refined**: Fixed contrast issues and restored the "Liquid Glass" aesthetic in dark mode.
* **🧹 Code Quality**: Resolved numerous linter warnings (CSS syntax, inline styles) for a cleaner codebase.
* **🚀 Performance**: Optimized large list rendering for the patient index.
* **📦 OSS Prep**: Improved the anonymization script to better separate private assets from the public code.

## 🚀 Getting Started (Dev)

1. **Clone**: `git clone ...`
2. **Install**: `npm install`
3. **Run**: `npm run dev`
4. **Setup Drugs**: Go to Settings -> Upload `confezioni.csv` (available from AIFA).

## License

MIT License.
