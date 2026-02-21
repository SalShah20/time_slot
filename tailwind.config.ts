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
        background: "var(--background)",
        foreground: "var(--foreground)",
        teal: {
          50:  "#e6f7f9",
          100: "#b3e8ed",
          200: "#80d8e1",
          300: "#4dc9d5",
          400: "#26bdc9",
          500: "#028090",
          600: "#027381",
          700: "#016370",
          800: "#01535e",
          900: "#00404a",
        },
        surface: {
          50:  "#f8fafb",
          100: "#f0f3f5",
          200: "#e1e7eb",
          300: "#c8d3d9",
          400: "#a8b8c2",
          500: "#8899a6",
          600: "#697c8a",
          700: "#546370",
          800: "#3e4c57",
          900: "#2a343d",
        },
      },
      keyframes: {
        "pulse-ring": {
          "0%":   { transform: "scale(1)", opacity: "0.8" },
          "50%":  { transform: "scale(1.4)", opacity: "0.3" },
          "100%": { transform: "scale(1)", opacity: "0.8" },
        },
        tick: {
          "0%":   { transform: "scale(1)" },
          "50%":  { transform: "scale(1.06)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2s ease-in-out infinite",
        tick: "tick 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
