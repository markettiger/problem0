import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const RSS_URL = 'https://getonthepodium.tistory.com/rss';
const SITE_ORIGIN = 'https://getonthepodium.tistory.com';
const BLOG_DIR = join(process.cwd(), 'src/content/blog');
const IMAGE_PUBLIC_ROOT = join(process.cwd(), 'public/images/blog');
const USER_AGENT = 'Mozilla/5.0 (compatible; problem0-tistory-migrator/1.0)';
const MAX_CATEGORY_PAGES = 12;

const CATEGORY_MAP = new Map([
  ['Reference', '고객 사례'],
  ['Blog', '마케팅 인사이트']
]);

async function main() {
  await mkdir(BLOG_DIR, { recursive: true });
  await mkdir(IMAGE_PUBLIC_ROOT, { recursive: true });
  await cleanGeneratedContent();

  const rssItems = await fetchRssItems();
  const categoryItems = await discoverCategoryItems();
  const items = mergeItems([...rssItems, ...categoryItems]);

  const usedSlugs = new Set();
  let migratedCount = 0;

  for (const [index, item] of items.entries()) {
    const fullItem = await fetchEntryItem(item);
    const slug = getUniqueSlug(createSlug(item), usedSlugs, index);
    const imageDir = join(IMAGE_PUBLIC_ROOT, slug);
    await mkdir(imageDir, { recursive: true });

    const preferredThumbnail = await downloadPreferredThumbnail(fullItem.thumbnail, fullItem.link, slug, imageDir);
    const { html, thumbnail } = await localizeImages(fullItem.html, fullItem.link, slug, imageDir, preferredThumbnail ? 1 : 0);
    const markdown = convertMarkdownLinkCards(normalizeImportedMarkdown(htmlToMarkdown(html)), preferredThumbnail || thumbnail);
    const description = createDescription(markdown || stripHtml(fullItem.html));
    const frontmatter = createFrontmatter({
      title: fullItem.title,
      description,
      pubDate: toDateOnly(fullItem.pubDate),
      category: fullItem.category,
      tags: [fullItem.category],
      thumbnail: preferredThumbnail || thumbnail,
      originalUrl: fullItem.link
    });

    await writeFile(join(BLOG_DIR, `${slug}.md`), `${frontmatter}\n\n${markdown}\n`, 'utf8');
    migratedCount += 1;
  }

  console.log(`Migrated ${migratedCount} Tistory posts into ${BLOG_DIR}`);
}

async function cleanGeneratedContent() {
  const blogFiles = await readdir(BLOG_DIR).catch(() => []);
  await Promise.all(
    blogFiles
      .filter((file) => file.endsWith('.md'))
      .map((file) => rm(join(BLOG_DIR, file), { force: true }))
  );

  await rm(IMAGE_PUBLIC_ROOT, { recursive: true, force: true });
  await mkdir(IMAGE_PUBLIC_ROOT, { recursive: true });
}

async function fetchRssItems() {
  const rss = await fetchText(RSS_URL);
  return parseRssItems(rss)
    .map(normalizeRssItem)
    .filter((item) => item.category);
}

async function discoverCategoryItems() {
  const items = [];

  for (const sourceCategory of CATEGORY_MAP.keys()) {
    for (let page = 1; page <= MAX_CATEGORY_PAGES; page += 1) {
      const pageUrl = `${SITE_ORIGIN}/category/${encodeURIComponent(sourceCategory)}${page > 1 ? `?page=${page}` : ''}`;
      let html = '';

      try {
        html = await fetchText(pageUrl);
      } catch (error) {
        console.warn(`Could not fetch category page: ${pageUrl} (${error.message})`);
        break;
      }

      const links = extractEntryLinks(html);
      if (links.length === 0) break;

      links.forEach((link) => {
        items.push({
          title: '',
          link,
          pubDate: '',
          html: '',
          sourceCategory,
          category: CATEGORY_MAP.get(sourceCategory)
        });
      });
    }
  }

  return items;
}

function mergeItems(items) {
  const byLink = new Map();

  items.forEach((item) => {
    if (!item.link || !item.category) return;
    const key = item.link.replace(/#.*$/, '').replace(/\?.*$/, '');
    const existing = byLink.get(key);
    byLink.set(key, { ...item, ...existing, html: existing?.html || item.html });
  });

  return [...byLink.values()];
}

async function fetchEntryItem(item) {
  let pageHtml = '';

  try {
    pageHtml = await fetchText(item.link);
  } catch (error) {
    console.warn(`Could not fetch entry page: ${item.link} (${error.message})`);
  }

  if (!pageHtml) return item;

  return {
    ...item,
    title: item.title || extractMeta(pageHtml, 'og:title') || extractTitle(pageHtml),
    pubDate: item.pubDate || extractPublishedDate(pageHtml),
    html: extractArticleHtml(pageHtml) || item.html,
    thumbnail: item.thumbnail || extractThumbnail(pageHtml),
    sourceCategory: item.sourceCategory || extractSourceCategory(pageHtml),
    category: item.category || CATEGORY_MAP.get(extractSourceCategory(pageHtml)) || ''
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseRssItems(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([itemXml]) => itemXml);
}

function normalizeRssItem(itemXml) {
  const categories = getTags(itemXml, 'category').map(cleanXmlText);
  const sourceCategory = categories.find((category) => CATEGORY_MAP.has(category));

  return {
    title: cleanXmlText(getTag(itemXml, 'title')),
    link: cleanXmlText(getTag(itemXml, 'link')),
    pubDate: cleanXmlText(getTag(itemXml, 'pubDate')),
    html: cleanXmlText(getTag(itemXml, 'content:encoded') || getTag(itemXml, 'description')),
    thumbnail: extractRssThumbnail(itemXml),
    sourceCategory,
    category: sourceCategory ? CATEGORY_MAP.get(sourceCategory) : ''
  };
}

function extractEntryLinks(html) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/entry\/[^"']+)["'][^>]*>/gi)]
    .map((match) => toAbsoluteUrl(cleanXmlText(match[1]), SITE_ORIGIN))
    .map((url) => url.replace(/#.*$/, '').replace(/\?.*$/, ''))
    .filter((url) => url.startsWith(`${SITE_ORIGIN}/entry/`))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function extractMeta(html, property) {
  const pattern = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escapeRegExp(property)}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapeRegExp(property)}["'][^>]*>`, 'i');
  return cleanXmlText(html.match(pattern)?.[1] || html.match(reversePattern)?.[1] || '');
}

function extractTitle(html) {
  return cleanXmlText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s*::.*$/, '');
}

function extractPublishedDate(html) {
  return (
    extractMeta(html, 'article:published_time') ||
    cleanXmlText(html.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || '') ||
    cleanXmlText(html.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/i)?.[0] || '')
  );
}

function extractThumbnail(html) {
  return (
    extractMeta(html, 'og:image') ||
    extractMeta(html, 'twitter:image') ||
    cleanXmlText(html.match(/<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || '')
  );
}

function extractRssThumbnail(itemXml) {
  return (
    cleanXmlText(itemXml.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i)?.[1] || '') ||
    cleanXmlText(itemXml.match(/<media:content\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i)?.[1] || '') ||
    cleanXmlText(itemXml.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["'][^>]*\/?>/i)?.[1] || '')
  );
}

function extractSourceCategory(html) {
  const category = cleanXmlText(html.match(/\/category\/(Reference|Blog)\b/i)?.[1] || '');
  if (category) return category;

  const keywords = extractMeta(html, 'article:section') || extractMeta(html, 'keywords');
  if (keywords.includes('Reference')) return 'Reference';
  if (keywords.includes('Blog')) return 'Blog';
  return '';
}

function extractArticleHtml(html) {
  const candidates = [
    /<div\b[^>]*class=["'][^"']*(?:entry-content|article-view|contents_style|tt_article_useless_p_margin|post-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div\b[^>]*class=["'][^"']*(?:container_postbtn|another_category|related)[^"']*["']|<\/article>|<footer)/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return extractMeta(html, 'description');
}

async function downloadPreferredThumbnail(source, pageUrl, slug, imageDir) {
  if (!source || isTrackingImage(source)) return '';

  const absoluteUrl = toAbsoluteUrl(source, pageUrl);

  try {
    const response = await fetch(absoluteUrl, {
      headers: {
        'user-agent': USER_AGENT,
        referer: pageUrl
      }
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    const extension = getImageExtension(absoluteUrl, contentType);
    const fileName = `thumbnail${extension}`;
    const publicPath = `/images/blog/${slug}/${fileName}`;
    const buffer = Buffer.from(await response.arrayBuffer());

    await writeFile(join(imageDir, fileName), buffer);
    return publicPath;
  } catch (error) {
    console.warn(`Could not download thumbnail: ${absoluteUrl} (${error.message})`);
    return '';
  }
}

function getTag(xml, tagName) {
  const escapedName = tagName.replace(':', '\\:');
  const match = xml.match(new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'i'));
  return match ? match[1] : '';
}

function getTags(xml, tagName) {
  const escapedName = tagName.replace(':', '\\:');
  return [...xml.matchAll(new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, 'gi'))].map((match) => match[1]);
}

function cleanXmlText(value = '') {
  return decodeEntities(value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim());
}

async function localizeImages(html, pageUrl, slug, imageDir, startIndex = 0) {
  let imageIndex = startIndex;
  let thumbnail = '';
  let updatedHtml = html;
  const imageSources = extractImageSources(html);

  for (const source of [...new Set(imageSources)]) {
    imageIndex += 1;
    const absoluteUrl = toAbsoluteUrl(source, pageUrl);

    try {
      const response = await fetch(absoluteUrl, {
        headers: {
          'user-agent': USER_AGENT,
          referer: pageUrl
        }
      });

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const contentType = response.headers.get('content-type') || '';
      const extension = getImageExtension(absoluteUrl, contentType);
      const fileName = `image-${imageIndex}${extension}`;
      const publicPath = `/images/blog/${slug}/${fileName}`;
      const buffer = Buffer.from(await response.arrayBuffer());

      await writeFile(join(imageDir, fileName), buffer);
      updatedHtml = replaceImageSource(updatedHtml, source, publicPath);
      if (!thumbnail) thumbnail = publicPath;
    } catch (error) {
      console.warn(`Could not download image: ${absoluteUrl} (${error.message})`);
    }
  }

  return { html: updatedHtml, thumbnail };
}

function extractImageSources(html) {
  const sources = [];

  [...html.matchAll(/<img\b[^>]*>/gi)].forEach(([tag]) => {
    const directSource = getAttribute(tag, 'src') || getAttribute(tag, 'data-src') || getAttribute(tag, 'data-original') || getAttribute(tag, 'data-image-src');
    const srcset = getAttribute(tag, 'srcset') || getAttribute(tag, 'data-srcset');

    if (directSource && !isTrackingImage(directSource)) sources.push(directSource);
    if (srcset) {
      sources.push(
        ...srcset
          .split(',')
          .map((part) => part.trim().split(/\s+/)[0])
          .filter((source) => source && !isTrackingImage(source))
      );
    }
  });

  return sources;
}

function replaceImageSource(html, source, publicPath) {
  return html
    .split(source)
    .join(publicPath)
    .replace(/<img\b([^>]*?)\bdata-src=["']([^"']+)["']([^>]*?)>/gi, (tag) => tag.replace(/\sdata-src=["'][^"']+["']/, ` src="${publicPath}"`))
    .replace(/<img\b([^>]*?)\bdata-original=["']([^"']+)["']([^>]*?)>/gi, (tag) => tag.replace(/\sdata-original=["'][^"']+["']/, ` src="${publicPath}"`))
    .replace(/<img\b([^>]*?)\bdata-image-src=["']([^"']+)["']([^>]*?)>/gi, (tag) => tag.replace(/\sdata-image-src=["'][^"']+["']/, ` src="${publicPath}"`));
}

function getAttribute(tag, attribute) {
  return tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'i'))?.[1] || '';
}

function isTrackingImage(source) {
  return source.startsWith('data:') || source.includes('/favicon') || source.includes('pixel');
}

function toAbsoluteUrl(source, pageUrl) {
  try {
    return new URL(source, pageUrl).toString();
  } catch {
    return source;
  }
}

function getImageExtension(url, contentType) {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';

  const extension = extname(new URL(url).pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) return extension;
  return '.jpg';
}

function createSlug(item) {
  const pathPart = safeDecode(new URL(item.link).pathname.split('/').filter(Boolean).pop() || '');
  const urlSlug = normalizeSlug(pathPart);
  if (urlSlug.length >= 3) return urlSlug;

  const titleSlug = normalizeSlug(item.title);
  if (titleSlug.length >= 3) return titleSlug;

  return `post-${toDateOnly(item.pubDate).replaceAll('-', '')}`;
}

function normalizeSlug(value) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function getUniqueSlug(slug, usedSlugs, index) {
  let candidate = slug || `post-${index + 1}`;
  let suffix = 2;

  while (usedSlugs.has(candidate)) {
    candidate = `${slug}-${suffix}`;
    suffix += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

function htmlToMarkdown(html) {
  let markdown = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi, '\n_$1_\n')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n')
    .replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => `\n\`\`\`\n${decodeEntities(stripHtml(code)).trim()}\n\`\`\`\n`)
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${stripHtml(text).trim()}](${href})`)
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const source = getAttribute(tag, 'src') || getAttribute(tag, 'data-src') || getAttribute(tag, 'data-original') || getAttribute(tag, 'data-image-src');
      const alt = getAttribute(tag, 'alt');
      return source ? `\n![${alt}](${source})\n` : '';
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/?(div|section|article|figure|span)\b[^>]*>/gi, '\n');

  markdown = stripHtml(markdown);
  markdown = decodeEntities(markdown)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');

  return markdown;
}

function normalizeImportedMarkdown(markdown) {
  const withoutTistoryFooter = removeTistoryFooter(markdown);
  const lines = withoutTistoryFooter.split('\n');
  const normalized = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '_' || /^\*{3,}$/.test(trimmed)) continue;

    const inlineHeading = trimmed.match(/^####\s+\*\*(.*?)\*\*$/);
    if (inlineHeading) {
      normalized.push(`### ${inlineHeading[1].trim()}`);
      continue;
    }

    if ((trimmed === '####' || trimmed === '#### **') && lines[index + 1]?.trim() === '**' && lines[index + 2]?.trim() && lines[index + 3]?.trim() === '**') {
      normalized.push(`### ${lines[index + 2].trim()}`);
      index += 3;
      continue;
    }

    if (trimmed === '####' && lines[index + 1]?.trim() && lines[index + 2]?.trim() === '**') {
      normalized.push(`### ${lines[index + 1].replace(/^\*\*/, '').trim()}`);
      index += 2;
      continue;
    }

    if (trimmed === '#### **' && lines[index + 1]?.trim() && /^\*{2,}$/.test(lines[index + 2]?.trim() || '')) {
      normalized.push(`### ${lines[index + 1].trim()}`);
      index += 2;
      continue;
    }

    if (trimmed.startsWith('> **이런 분이 읽으면 좋아요')) {
      normalized.push(line);
      while (lines[index + 1]?.trim().startsWith('⚈')) {
        index += 1;
        normalized.push(`> ${lines[index].trim()}`);
      }
      continue;
    }

    if (trimmed === '>' && lines[index + 1]?.trim().startsWith('**이런 분이 읽으면 좋아요')) {
      index += 1;
      normalized.push(`> ${lines[index].trim()}`);
      while (lines[index + 1] !== undefined && (lines[index + 1].trim() === '' || lines[index + 1].trim().startsWith('⚈'))) {
        index += 1;
        if (lines[index].trim() === '') continue;
        normalized.push(`> ${lines[index].trim()}`);
      }
      continue;
    }

    if (trimmed === '-' && lines[index + 1]?.trim()) {
      normalized.push(`- ${lines[index + 1].trim()}`);
      index += 1;
      continue;
    }

    normalized.push(line);
  }

  return separateImageParagraphs(closeBlockquoteCallouts(repairSplitResultCallouts(normalized.join('\n').replace(/\n{3,}/g, '\n\n')))).trim();
}

function repairSplitResultCallouts(markdown) {
  return markdown
    .replace(/\*\*\s+([^*\n]*?)\s*\*\*/g, '**$1**')
    .replace(/\[\s*\*\*/g, '[**')
    .replace(/\*\*\s*\]/g, '**]')
    .replace(/>\s*\*\*\s*이런 분이 읽으면 좋아요! 👍\s*\*\*/g, '> **이런 분이 읽으면 좋아요! 👍**')
    .replace(
      /\*\n\n\*이 글은\n \[frase\.io\]\(http:\/\/frase\.io\)\n에서 발행한\n \[What is Generative Engine Optimization\(GEO\)\? Complete Guide 2025\]\(https:\/\/www\.frase\.io\/blog\/what-is-generative-engine-optimization-geo\)\n를 참고했습니다\.\n\n\*/g,
      '_\\*이 글은 [frase.io](http://frase.io) 에서 발행한 [What is Generative Engine Optimization(GEO)? Complete Guide 2025](https://www.frase.io/blog/what-is-generative-engine-optimization-geo)를 참고했습니다._',
    )
    .replace(
      /GEO는 ChatGPT, Perplexity, Google AI Overviews\(Gemini랑 달라요!\), Claude와 같은 플랫폼에서 AI가 생성한 응답에 우리 브랜드의 콘텐츠가 출처 및 인용으로 표시되도록 최적화하는 방법론입니다\. SEO가 포털에서의 검색 결과 순위에 중점을 둔다면\n\n\*\*GEO는 AI 엔진이 사용자의 질문에 답변할 때 인용될 수 있도록 콘텐츠를 작성하는 걸 의미\*\*\n\n합니다\./g,
      'GEO는 ChatGPT, Perplexity, Google AI Overviews(Gemini랑 달라요!), Claude와 같은 플랫폼에서 AI가 생성한 응답에 우리 브랜드의 콘텐츠가 출처 및 인용으로 표시되도록 최적화하는 방법론입니다. SEO가 포털에서의 검색 결과 순위에 중점을 둔다면 **GEO는 AI 엔진이 사용자의 질문에 답변할 때 인용될 수 있도록 콘텐츠를 작성하는 걸 의미**합니다.',
    )
    .replace(
      /&lsquo;AI의 답변에 우리 콘텐츠를 참조 자료로 띄운다!&rsquo; 그건 알겠는데 이게 왜 중요하냐\? 이미 많은 분들이 몸으로 느끼고 계시겠지만\n \[AI를 통한 세션 방문은 2025년 1월부터 5월 사이에만 527% 폭증\]\(https:\/\/searchengineland\.com\/ai-traffic-up-seo-rewritten-459954\)\n했습니다\. 글로벌 데이터 기준 Perplexity가 한 달에 처리하는 검색만 5억 건이 넘어갑니다\./g,
      '‘AI의 답변에 우리 콘텐츠를 참조 자료로 띄운다!’ 그건 알겠는데 이게 왜 중요하냐? 이미 많은 분들이 몸으로 느끼고 계시겠지만 [AI를 통한 세션 방문은 2025년 1월부터 5월 사이에만 527% 폭증](https://searchengineland.com/ai-traffic-up-seo-rewritten-459954)했습니다. 글로벌 데이터 기준 Perplexity가 한 달에 처리하는 검색만 5억 건이 넘어갑니다.',
    )
    .replace(
      /> - 이전 대비 운영 첫 달 CPI\n\n\*\*22% 하락\*\*\n\n- 이전 대비 운영 마지막 달 CPI\n\n\*\*62% 하락\*\*/g,
      '> \\- 이전 대비 운영 첫 달 CPI **22% 하락**\n> \\- 이전 대비 운영 마지막 달 CPI **62% 하락**',
    )
    .replace(
      /> - 첫 달 광고비\n\*\*9% 상승\*\*\n\n- 첫 달 구매전환\n\*\*182% 상승\*\*/g,
      '> \\- 첫 달 광고비 **9% 상승**\n> \\- 첫 달 구매전환 **182% 상승**',
    )
    .replace(
      /> - 첫 달 광고비 \*\*\n20% 삭감\n\n\*\*- 첫 달 구매전환\n\*\*50% 상승\*\*\n\n- 협업 마지막 달에 첫 달 대비\n\*\*매출 4배 상승\*\*/g,
      '> \\- 첫 달 광고비 **20% 삭감**\n> \\- 첫 달 구매전환 **50% 상승**\n> \\- 협업 마지막 달에 첫 달 대비 **매출 4배 상승**',
    )
    .replace(
      /> - 이전 달 대비 구매전환율\n\*\*2배 상승\*\*\n\n- 이전 달 대비 회원가입률\n\*\*3.5배 상승\*\*/g,
      '> \\- 이전 달 대비 구매전환율 **2배 상승**\n> \\- 이전 달 대비 회원가입률 **3.5배 상승**',
    );
}

function closeBlockquoteCallouts(markdown) {
  const lines = markdown.split('\n');
  const closed = [];

  for (let index = 0; index < lines.length; index += 1) {
    closed.push(lines[index]);

    const current = lines[index].trim();
    const next = lines[index + 1]?.trim();
    if (current.startsWith('> ') && next && !next.startsWith('> ')) {
      closed.push('');
    }
  }

  return closed.join('\n').replace(/\n{3,}/g, '\n\n');
}

function separateImageParagraphs(markdown) {
  const imagePattern = /^!\[[^\]]*]\([^)]*\)$/;
  const captionPattern = /^_[^_].*_$/;
  const lines = markdown.split('\n');
  const separated = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const previous = separated.at(-1)?.trim();

    if (imagePattern.test(trimmed) && previous && previous !== '---') {
      separated.push('');
    }

    separated.push(line);

    const next = lines[index + 1]?.trim();
    if (imagePattern.test(trimmed) && next && captionPattern.test(next)) {
      separated.push('');
    }
  }

  return separated.join('\n').replace(/\n{3,}/g, '\n\n');
}

function convertMarkdownLinkCards(markdown, fallbackImage = '') {
  return markdown.replace(/\[\s*\n([\s\S]*?)\]\((https?:\/\/[^)]+)\)/g, (match, label, url, offset) => {
    const lines = label.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return match;

    const domain = lines.at(-1) || new URL(url).hostname;
    const title = lines[0] || domain;
    const description = lines.slice(1, -1).join(' ');
    const image = nearestPreviousMarkdownImage(markdown, offset) || fallbackImage;

    return [
      `<a class="link-preview-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">`,
      `  ${image ? `<span class="link-preview-card__image"><img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" /></span>` : '<span class="link-preview-card__image link-preview-card__image--empty" aria-hidden="true"></span>'}`,
      '  <span class="link-preview-card__body">',
      `    <strong>${escapeHtml(title)}</strong>`,
      description ? `    <span>${escapeHtml(description)}</span>` : '',
      '  </span>',
      '</a>'
    ].filter(Boolean).join('\n');
  });
}

function nearestPreviousMarkdownImage(markdown, index) {
  const before = markdown.slice(0, index);
  const images = [...before.matchAll(/!\[[^\]]*]\((\/images\/[^)]+)\)/g)];
  return images.at(-1)?.[1] || '';
}

function removeTistoryFooter(markdown) {
  const markers = ['\n공유하기\n', "\n#### '[Blog]", "\n#### '[Reference]", '\n## 태그\n'];
  const positions = markers.map((marker) => markdown.indexOf(marker)).filter((index) => index !== -1);
  if (!positions.length) return markdown;
  return markdown.slice(0, Math.min(...positions)).trimEnd();
}

function stripHtml(value = '') {
  return value.replace(/<[^>]+>/g, '');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createDescription(markdown) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/[#>*_`[\]()~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function createFrontmatter(data) {
  return [
    '---',
    `title: ${yamlString(data.title)}`,
    `description: ${yamlString(data.description)}`,
    `pubDate: ${data.pubDate}`,
    `category: ${yamlString(data.category)}`,
    `tags: [${data.tags.map(yamlString).join(', ')}]`,
    `thumbnail: ${yamlString(data.thumbnail)}`,
    `originalUrl: ${yamlString(data.originalUrl)}`,
    '---'
  ].join('\n');
}

function yamlString(value = '') {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeEntities(value = '') {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
