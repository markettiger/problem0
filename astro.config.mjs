import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://problem0.kr',
  integrations: [
    tailwind({
      applyBaseStyles: false
    })
  ]
});
