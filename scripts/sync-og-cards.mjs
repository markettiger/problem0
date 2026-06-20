import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const BLOG_DIR = join(process.cwd(), 'src/content/blog');
const IMAGE_PUBLIC_ROOT = join(process.cwd(), 'public/images/blog');
const USER_AGENT = 'Mozilla/5.0 (compatible; problem0-og-card-sync/1.0)';

async function main() {
  const files = (await readdir(BLOG_DIR)).filter((file) => file.endsWith('.md'));
  let updatedCards = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const path = join(BLOG_DIR, file);
    const markdown = await readFile(path, 'utf8');
    const cards = [...markdown.matchAll(/<a class="link-preview-card" href="([^"]+)"[\s\S]*?<\/a>/g)];

    if (!cards.length) continue;

    let nextMarkdown = markdown;
    const imageDir = join(IMAGE_PUBLIC_ROOT, slug);
    await mkdir(imageDir, { recursive: true });

    for (const [index, card] of cards.entries()) {
      const cardHtml = card[0];
      const cardUrl = card[1];
      const ogImageUrl = await fetchOgImage(cardUrl);

      if (!ogImageUrl) {
        console.warn(`No og:image found: ${cardUrl}`);
        continue;
      }

      const localImagePath = await downloadImage(ogImageUrl, cardUrl, imageDir, slug, index + 1);
      if (!localImagePath) continue;

      const nextCardHtml = replaceCardImage(cardHtml, localImagePath);
      if (nextCardHtml !== cardHtml) {
        nextMarkdown = nextMarkdown.replace(cardHtml, nextCardHtml);
        updatedCards += 1;
      }
    }

    if (nextMarkdown !== markdown) {
      await writeFile(path, nextMarkdown, 'utf8');
    }
  }

  console.log(`Updated ${updatedCards} OG card image(s).`);
}

async function fetchOgImage(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const html = await response.text();
    const image =
      extractMeta(html, 'og:image') ||
      extractMeta(html, 'og:image:url') ||
      extractMeta(html, 'twitter:image') ||
      extractMeta(html, 'twitter:image:src');

    return image ? new URL(decodeHtml(image), response.url || url).toString() : '';
  } catch (error) {
    console.warn(`Could not fetch OG image: ${url} (${error.message})`);
    return '';
  }
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  return html.match(pattern)?.[1] || html.match(reversePattern)?.[1] || '';
}

async function downloadImage(imageUrl, pageUrl, imageDir, slug, index) {
  try {
    const response = await fetch(imageUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        referer: pageUrl,
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*'
      }
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    const extension = getImageExtension(response.url || imageUrl, contentType);
    const fileName = `og-card-${index}${extension}`;
    const publicPath = `/images/blog/${slug}/${fileName}`;
    const buffer = Buffer.from(await response.arrayBuffer());

    await writeFile(join(imageDir, fileName), buffer);
    return publicPath;
  } catch (error) {
    console.warn(`Could not download OG image: ${imageUrl} (${error.message})`);
    return '';
  }
}

function replaceCardImage(cardHtml, imagePath) {
  if (/<span class="link-preview-card__image">[\s\S]*?<img\b[\s\S]*?<\/span>/.test(cardHtml)) {
    return cardHtml.replace(
      /<span class="link-preview-card__image">[\s\S]*?<img\b[^>]*src="[^"]+"[^>]*>[\s\S]*?<\/span>/,
      `<span class="link-preview-card__image"><img src="${imagePath}" alt="" loading="lazy" decoding="async" /></span>`
    );
  }

  return cardHtml.replace(
    /<span class="link-preview-card__image link-preview-card__image--empty" aria-hidden="true"><\/span>/,
    `<span class="link-preview-card__image"><img src="${imagePath}" alt="" loading="lazy" decoding="async" /></span>`
  );
}

function getImageExtension(url, contentType) {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('svg')) return '.svg';

  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(extension)) return extension;
  } catch {
    return '.jpg';
  }

  return '.jpg';
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
