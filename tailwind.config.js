/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Pulse brand palette (ported from the source design's @theme block)
        pulse: {
          orange: '#F79B1E',
          'orange-light': '#FBB454',
          'orange-dark': '#E68A0D',
          blue: '#252B59',
          'blue-light': '#3A4178',
          'blue-dark': '#1A1E3F',
        },
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.12)',
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(120%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.35s ease-out both',
      },
    },
  },
  plugins: [],
};
