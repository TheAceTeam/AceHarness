import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const eslintConfig = [
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
    },
  },
  {
    files: [
      'src/app/page.tsx',
      'src/app/workbench/[config]/WorkbenchClient.tsx',
      'src/components/chat/HomeCommandSidebar.tsx',
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/display-name': 'off',
    },
  },
  {
    ignores: [
      'out/**',
      'build/**',
      'dist/**',
      'dist-build/**',
      'coverage/**',
    ],
  },
];

export default eslintConfig;
