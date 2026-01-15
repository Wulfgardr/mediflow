import type { Config } from "tailwindcss";

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
                // Apple System Colors & Semantics
                apple: {
                    blue: "var(--apple-blue)",
                    gray: "var(--apple-gray)",
                },
                system: {
                    gray6: "var(--system-gray-6)",
                }
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
};
export default config;
