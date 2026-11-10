import type { Config } from 'tailwindcss';

/**
 * Tailwind is introduced alongside the existing stylesheets, so:
 *  - `prefix: 'tw-'` means utilities can never collide with legacy class names;
 *  - `preflight` is off so Tailwind's reset does not restyle existing screens.
 * Both can be removed once the legacy CSS is fully migrated.
 */
export default {
  prefix: 'tw-',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        gold: { 50: '#fff9e6', 100: '#fdeeb8', 300: '#f2cf63', 500: '#d4a72c', 600: '#b98a14', 700: '#946b0c' },
        royal: { 700: '#14213d', 800: '#0d1730', 900: '#080f21' },
      },
      boxShadow: { glow: '0 0 40px -8px rgba(212,167,44,.55)' },
      keyframes: { shimmer: { '100%': { transform: 'translateX(100%)' } } },
      animation: { shimmer: 'shimmer 1.6s infinite' },
    },
  },
} satisfies Config;
