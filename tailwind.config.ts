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
        fontSize: {
            xs: ['0.75rem', { lineHeight: '1.5' }],
            sm: ['0.8125rem', { lineHeight: '1.5' }],
            base: ['0.875rem', { lineHeight: '1.5' }],
            lg: ['0.9375rem', { lineHeight: '1.5' }],
            xl: ['1.625rem', { lineHeight: '1.2' }],
            '2xl': ['1.625rem', { lineHeight: '1.2' }],
            '3xl': ['1.625rem', { lineHeight: '1.2' }],
            '4xl': ['1.625rem', { lineHeight: '1.2' }],
        },
        fontWeight: {
            thin: '400', extralight: '400', light: '400', normal: '400', medium: '400',
            semibold: '600', bold: '600', extrabold: '600', black: '600',
        },
    },
    plugins: [
        typography,
    ],
};
export default config;
