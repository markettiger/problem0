import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { DEFAULT_DESCRIPTION, DEFAULT_SITE_URL, absoluteUrl } from '../utils/seo';

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
  const feedUrl = absoluteUrl('/rss.xml', baseUrl);
  const blogUrl = absoluteUrl('/blog', baseUrl);
  const posts = (await getCollection('blog'))
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
  const lastBuildDate = posts[0]?.data.pubDate.toUTCString() || new Date().toUTCString();

  const items = posts
    .map((post) => {
      const postUrl = absoluteUrl(`/blog/${post.slug}`, baseUrl);

      return `    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <description>${escapeXml(post.data.description)}</description>
      <category>${escapeXml(post.data.category)}</category>
      <pubDate>${post.data.pubDate.toUTCString()}</pubDate>
    </item>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>프로블럼제로 문제 해결 블로그</title>
    <link>${escapeXml(blogUrl)}</link>
    <description>${escapeXml(DEFAULT_DESCRIPTION)}</description>
    <language>ko-KR</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8'
    }
  });
};
