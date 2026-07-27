/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          400: '#d4a06a',
          500: '#c07838',
        },
      },
    },
  },
  plugins: [],
}
