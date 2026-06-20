export default {
  content: ['./src/**/*.{astro,html,js,md,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1E572D',
        accent: '#E9E616',
        sub: '#71862D',
        soft: '#DFE6D5',
        paper: '#FFFFFF',
        ink: '#000000',
        mute: '#000000'
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        crisp: '0 14px 0 #71862D'
      }
    }
  },
  plugins: []
};
