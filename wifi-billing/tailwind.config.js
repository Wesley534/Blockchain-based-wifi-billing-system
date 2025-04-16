/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
      extend: {
        colors: {
          "dark-bg-start": "#1a1a2e", // Darker shade for gradient
          "dark-bg-end": "#4b1c71",   // Purple/pink shade for gradient
          "theme-blue": "#3b82f6",    // Blue for the button
        },
      },
    },
    plugins: [],
  };