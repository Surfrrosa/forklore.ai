import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0B",
        panel: "#0F0F12",
        fg: "#EDEDED",
        muted: "#A1A1AA",
        line: "#202026",
        brand1: "#FF7A45",  // Warm orange
        brand2: "#FF4500",  // Classic Reddit orange
        action: "#FF4500",  // Reddit orange for interactive elements
        ok: "#22C55E",
        warn: "#F59E0B",
        err: "#EF4444",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 0 0 rgba(255,255,255,0.04), 0 8px 30px -20px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
export default config;
