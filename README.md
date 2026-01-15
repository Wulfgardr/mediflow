# MediFlow - Open Source Medical Record App

MediFlow is a local-first, privacy-focused medical record application designed for district doctors and small clinics. It features a modern UI, offline capabilities, and powerful tools for managing patient data, therapies, and clinical diaries.


## Features

* **Local-First & Secure:** All data is stored locally in the browser (IndexedDB) and on your device. Zero cloud dependency by default.
* **Modern UI:** Built with Next.js 15, Tailwind CSS, and Framer Motion for a fluid, "Apple-like" experience.
* **AI Assistant:** Integrated local AI (via Ollama) or remote (OpenAI) for clinical decision support and summary generation.
* **Drug Database:** Integrated AIFA drug database with smart search and dosage filtering.
* **ICD-9 & ICD-11:** Support for standard disease classification systems.
* **Therapy Management:** Structured prescription builder with print-ready PDF generation.
* **Privacy Mode:** One-click feature to blur sensitive data on screen.

## Getting Started

### Prerequisites

* Node.js 18+
* npm or pnpm or bun

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/Wulfgardr/mediflow.git
    cd mediflow
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Run the development server:

    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser.

## Configuration

### AI Setup (Optional)

To use the AI Assistant features:

1. **Local (Ollama):** Install [Ollama](https://ollama.ai) and pull the models (`medgemma`, `llama3`).

    ```bash
    ollama pull medgemma
    ```

2. **Remote (OpenAI):** Create a `.env.local` file and add your key:

    ```env
    OPENAI_API_KEY=your_key_here
    ```

### Drug Database

Download the `confezioni.csv` file from [AIFA Open Data](https://www.aifa.gov.it/dati-aperti) and import it via the Settings page to populate the drug search.

## Tech Stack

* **Framework:** Next.js 15 (App Router)
* **Styling:** Tailwind CSS v4
* **Database:** Dexie.js (IndexedDB wrapper)
* **Formatting:** React Markdown, Lucide Icons
* **State:** React Context + Hooks

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
