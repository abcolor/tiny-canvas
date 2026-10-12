import type { Config } from 'tailwindcss';

// TinyCanvas 的視覺語彙：主色 #0087DC（brand-600，依使用者指定）、暖灰為中性色
export default {
  content: [],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef8ff',
          100: '#d9eefd',
          200: '#bce1fb',
          300: '#8ccff8',
          400: '#4fb4f1',
          500: '#1e9ce8',
          600: '#0087dc',
          700: '#006db6',
          800: '#055b95',
          900: '#0a4b7a',
        },
        ink: {
          50: '#f7f7f5',
          100: '#efeeeb',
          200: '#dedcd6',
          300: '#c4c1b8',
          400: '#9c988c',
          500: '#7a766a',
          600: '#5f5c52',
          700: '#4a4841',
          800: '#33322d',
          900: '#1f1e1b',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans TC Variable"', '"PingFang TC"', '"Microsoft JhengHei"', 'sans-serif'],
      },
      boxShadow: {
        float: '0 4px 16px -4px rgb(31 30 27 / 0.18), 0 1px 3px rgb(31 30 27 / 0.08)',
      },
    },
  },
} satisfies Config;
