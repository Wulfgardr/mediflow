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
                /* @Codex WUL-UIUX (STREAM E): il vocabolario Liquid Glass vive nei
                   custom properties --mf-*; qui li promuoviamo a utility Tailwind
                   (text-ink, bg-glass, border-glass, ...) cosi i call-site smettono
                   di ripetere valori arbitrari [color:var(--mf-*)]. */
                ink: "var(--mf-ink)",
                muted: "var(--mf-muted)",
                primary: "var(--mf-primary)",
                accent: "var(--mf-accent)",
                plum: "var(--mf-plum)",
                warning: "var(--mf-warning)",
                critical: "var(--mf-critical)",
                success: "var(--mf-success)",
                glass: {
                    DEFAULT: "var(--glass-bg)",
                    bg: "var(--mf-bg)",
                    elevated: "var(--mf-bg-elevated)",
                    strong: "var(--mf-bg-strong)",
                    border: "var(--glass-border)",
                },
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
