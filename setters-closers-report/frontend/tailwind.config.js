/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
      colors: { brand: { 50: "#eef5fd", 100: "#d8e8fa", 500: "#2a78d6", 600: "#2166bd", 700: "#1b5399" } },
    },
  },
  plugins: [],
};
