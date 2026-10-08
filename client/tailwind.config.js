/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b1b8c8',
          400: '#8792a8',
          500: '#68758d',
          600: '#525d74',
          700: '#434c5e',
          800: '#3a4150',
          900: '#191c24',
        },
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb5ff',
          400: '#598cff',
          500: '#3465f5',
          600: '#2148e2',
          700: '#1b39b6',
          800: '#1c3390',
          900: '#1c2f72',
        },
        accent: { 500: '#12b981', 600: '#0d9668' },
        warn: { 500: '#f59e0b', 600: '#d97706' },
        danger: { 500: '#ef4444', 600: '#dc2626' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)',
        lift: '0 10px 30px -12px rgba(16,24,40,.25)',
      },
    },
  },
  plugins: [],
};
