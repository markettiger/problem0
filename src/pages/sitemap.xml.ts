import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { DEFAULT_SITE_URL, absoluteUrl } from '../utils/seo';

const staticPages = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/about', priority: '0.8', changefreq: 'monthly' },
  { path: '/blog', priority: '0.8', changefreq: 'weekly' }
];

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  const baseUrl = site?.toString() || DEFAULT_SITE_URL;
  const posts = (await getCollection('blog'))
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const now = new Date().toISOString();
  const urls = [
    ...staticPages.map((page) => ({
      loc: absoluteUrl(page.path, baseUrl),
      lastmod: now,
      changefreq: page.changefreq,
      priority: page.priority
    })),
    ...posts.map((post) => ({
      loc: absoluteUrl(`/blog/${post.slug}`, baseUrl),
      lastmod: post.data.pubDate.toISOString(),
      changefreq: 'monthly',
      priority: '0.7'
    }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
    )
    .join('\n')}\n</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
};
