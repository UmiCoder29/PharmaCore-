/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
        title: ['"DM Serif Display"', 'serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
      boxShadow: {
        'soft': '0 6px 18px -8px rgba(16, 43, 43, .16), 0 2px 5px -2px rgba(16, 43, 43, .06)',
        'premium': '0 18px 38px -16px rgba(16, 43, 43, .22), 0 6px 16px -8px rgba(8, 123, 98, .10)',
        'float': '0 28px 55px -22px rgba(16, 43, 43, .30), 0 10px 24px -12px rgba(8, 123, 98, .16)',
        'glow': '0 0 0 2px oklch(99% 0.01 220 / <alpha-value>), 0 0 0 4px oklch(55% 0.15 155 / 0.4)', // focus ring style instead of neon glow
      },
      colors: {
        // --- NEW CLINICAL TOKENS ---
        clinical: '#F4F8F6',
        ink: '#102B2B',
        emerald: { DEFAULT: '#087B62' },
        amber: { DEFAULT: '#E79A2D' },
        terracotta: { DEFAULT: '#D14F4A' },
        aqua: { DEFAULT: '#35B9B1' },
        lilac: { DEFAULT: '#7566CC' },
        // --- LEGACY TOKENS (Preserved for LoginScreen) ---
        pharmacy: {
          50:  'oklch(97% 0.02 155 / <alpha-value>)',
          100: 'oklch(94% 0.04 155 / <alpha-value>)',
          200: 'oklch(88% 0.06 155 / <alpha-value>)',
          300: 'oklch(80% 0.1 155 / <alpha-value>)',
          400: 'oklch(70% 0.12 155 / <alpha-value>)',
          500: 'oklch(55% 0.15 155 / <alpha-value>)',
          600: 'oklch(45% 0.14 155 / <alpha-value>)',
          700: 'oklch(35% 0.12 155 / <alpha-value>)',
          800: 'oklch(25% 0.08 155 / <alpha-value>)',
          900: 'oklch(20% 0.06 155 / <alpha-value>)',
          950: 'oklch(15% 0.04 155 / <alpha-value>)',
        },
        cream: {
          50:  'oklch(99% 0.01 220 / <alpha-value>)',
          100: 'oklch(97% 0.01 220 / <alpha-value>)',
          200: 'oklch(94% 0.01 220 / <alpha-value>)',
          300: 'oklch(90% 0.01 220 / <alpha-value>)',
          400: 'oklch(85% 0.01 220 / <alpha-value>)',
          500: 'oklch(80% 0.01 220 / <alpha-value>)',
          600: 'oklch(70% 0.01 220 / <alpha-value>)',
          700: 'oklch(60% 0.01 220 / <alpha-value>)',
          800: 'oklch(50% 0.01 220 / <alpha-value>)',
          900: 'oklch(40% 0.01 220 / <alpha-value>)',
          950: 'oklch(30% 0.01 220 / <alpha-value>)',
        },
        charcoal: {
          50:  'oklch(95% 0.01 220 / <alpha-value>)',
          100: 'oklch(90% 0.01 220 / <alpha-value>)',
          200: 'oklch(80% 0.015 220 / <alpha-value>)',
          300: 'oklch(70% 0.015 220 / <alpha-value>)',
          400: 'oklch(60% 0.015 220 / <alpha-value>)',
          500: 'oklch(50% 0.015 220 / <alpha-value>)',
          600: 'oklch(40% 0.015 220 / <alpha-value>)',
          700: 'oklch(30% 0.015 220 / <alpha-value>)',
          800: 'oklch(20% 0.015 220 / <alpha-value>)',
          900: 'oklch(15% 0.015 220 / <alpha-value>)',
          950: 'oklch(10% 0.015 220 / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
