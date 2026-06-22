import type { Config } from 'tailwindcss';

// AGSI brand tokens — prompt §15.
// L-level palette:
//   L0 = midGray, L1 = accent, L2 = blue, L3 = green,
//   L4 = purple, L5 = gold

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        agsi: {
          navy: '#1A2A4A',
          blue: '#1F3C6E',
          accent: '#2B6CB0',
          purple: '#6B4F9E',
          green: '#2E7D52',
          gold: '#D4AF37',
          offWhite: '#F7F9FC',
          lightGray: '#E8EDF4',
          midGray: '#C5CDD8',
          darkGray: '#4A5568',
        },
        // RAG palette (dashboard KPI tiles)
        rag: {
          red: '#C53030',
          amber: '#DD8E2A',
          green: '#2E7D52',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Two extra sizes below text-xs (12px). The 50+ inline `text-[11px]`
      // and `text-[10px]` arbitraries across kanban cards, leadership
      // report tiles, and pipeline metadata are codified here.
      //   text-xxs = 10px / 14px line
      //   text-xs2 = 11px / 16px line
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '0.875rem' }],
        'xs2': ['0.6875rem', { lineHeight: '1rem' }],
      },
      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
      },
      borderRadius: {
        lg: '0.625rem',
      },
      boxShadow: {
        // Subtle — per §15 "subtle shadows, not borders"
        card: '0 1px 3px 0 rgb(26 42 74 / 0.04), 0 1px 2px -1px rgb(26 42 74 / 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
