import type { APIRoute } from 'astro';
import { DEFAULT_SITE_URL } from '../utils/seo';

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.toString() || DEFAULT_SITE_URL;

  return new Response(
    `User-agent: *
Allow: /

Sitemap: ${new URL('/sitemap.xml', baseUrl).toString()}
`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    }
  );
};
