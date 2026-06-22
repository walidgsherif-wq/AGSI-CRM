import type { Config } from 'tailwindcss';
import { AGSI, RAG } from './src/lib/design/colors';

// AGSI brand tokens — prompt §15.
// L-level palette:
//   L0 = midGray, L1 = accent, L2 = blue, L3 = green,
//   L4 = purple, L5 = gold
//
// Colour values are the AGSI / RAG palettes from src/lib/design/colors.ts
// so Tailwind tokens and runtime JS share a single source of truth.

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        agsi: AGSI,
        rag: RAG,
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
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
