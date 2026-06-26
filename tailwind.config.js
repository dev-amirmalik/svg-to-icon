/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0f1115",
        panel: "#161922",
        "panel-2": "#1c202b",
        border: "#272c38",
        accent: "#4c6ef5",
        "accent-2": "#5b7cfa",
        danger: "#ff6b6b",
        muted: "#9aa3b2",
      },
    },
  },
  plugins: [],
};
