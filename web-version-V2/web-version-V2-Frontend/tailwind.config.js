export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          'bg': '#1A1A1A',
          'header': '#242424',
          'active': '#0D4A9E',
          'text': '#FFFFFF',
          'accent': '#0090F1',
        },
        nord: {
          'text': {
            'primary': '#FFFFFF',
            'secondary': '#E6E6E6',
            'error': '#FF3333',
          },
          'button': {
            'primary': '#0078D4',
            'primary-hover': '#0090F1',
            'secondary': '#666666',
            'secondary-hover': '#808080',
          },
          'bg': {
            'card': '#2A2A2A',
            'hover': '#323232',
            'active': '#3D3D3D',
            'overlay': 'rgba(0, 0, 0, 0.75)',
            'overlay-light': 'rgba(0, 0, 0, 0.5)',
          },
          'load': {
            'low-bg': '#0B3B1F',
            'low-text': '#4AFF91',
            'medium-bg': '#2D4016',
            'medium-text': '#B8FF84',
            'warning-bg': '#3D3415',
            'warning-text': '#FFE484',
            'high-bg': '#3D1515',
            'high-text': '#FF9494',
            'critical-bg': '#4A1515',
            'critical-text': '#FFBEBE',
          },
          'ring': {
            'primary': '#0086F0',
            'error': '#FF6B6B',
            'secondary': '#606060',
          },
          'success': {
            'bg': '#0B3B1F',
            'text': '#6EFFAB',
          },
          'external': {
            'github': '#2EA043',
            'nord': '#4AA0FF',
          }
        }
      },
      minWidth: {
        'touch': '44px',
      },
      minHeight: {
        'touch': '44px',
      },
      spacing: {
        'touch': '44px',
      }
    },
  },
  plugins: [],
}