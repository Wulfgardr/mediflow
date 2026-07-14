import type { Config } from "tailwindcss";
/* @Codex */
import typography from '@tailwindcss/typography';

const config: Config = {
    darkMode: 'class', // Enable class-based dark mode
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                /* Lume espone superfici opache, inchiostro e segnali clinici. */
                ink: "var(--lume-ink)",
                muted: "var(--lume-ink-muted)",
                primary: "var(--lume-accent)",
                accent: "var(--lume-accent)",
                plum: "var(--lume-signal-plum)",
                warning: "var(--lume-signal-warning)",
                critical: "var(--lume-signal-critical)",
                success: "var(--lume-signal-success)",
            },
            fontSize: {
                /* @Codex WUL-UIUX (STREAM E): scala fissa che copre i px scritti a
                   mano nel codice (text-[8px] .. text-[28px]). Usare text-2xs ecc.
                   al posto dei valori arbitrari. */
                "3xs": ["8px", { lineHeight: "1.4" }],
                "2xs": ["10px", { lineHeight: "1.4" }],
                "xs+": ["11px", { lineHeight: "1.45" }],
                micro: ["9px", { lineHeight: "1.35" }],
            },
        },
    },
    plugins: [
        typography,
    ],
};
export default config;
