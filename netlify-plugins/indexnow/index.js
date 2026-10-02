import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const SITE_ORIGIN = 'https://problem0.kr';
const SITE_HOST = 'problem0.kr';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const INDEXNOW_KEY = '2bd29fc1-0c27-4713-ac2f-a5d3806e8a09';
const KEY_LOCATION = `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;
const BLOG_DIRECTORY = 'src/content/blog';
const KEY_FILE = `public/${INDEXNOW_KEY}.txt`;

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  const currentCommit = process.env.COMMIT_REF || 'HEAD';
  const cachedCommit = process.env.CACHED_COMMIT_REF;

  try {
    if (cachedCommit && cachedCommit !== currentCommit) {
      return runGit(['diff', '--name-only', cachedCommit, currentCommit]).split('\n').filter(Boolean);
    }

    return runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', currentCommit])
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    console.warn(`IndexNow: 변경 파일을 확인하지 못했습니다. ${error.message}`);
    return [];
  }
}

function publishedBlogSlugs() {
  return readdirSync(BLOG_DIRECTORY)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => !/^draft:\s*true\s*$/m.test(readFileSync(join(BLOG_DIRECTORY, file), 'utf8')))
    .map((file) => basename(file, '.md'));
}

function blogSlugsFromFiles(files) {
  const slugs = new Set();

  for (const file of files) {
    const contentMatch = file.match(/^src\/content\/blog\/([^/]+)\.md$/);
    const imageMatch = file.match(/^public\/images\/blog\/([^/]+)\//);
    const slug = contentMatch?.[1] || imageMatch?.[1];
    if (slug) slugs.add(slug);
  }

  return [...slugs];
}

function urlsToSubmit(files) {
  const isFirstIndexNowDeploy = files.includes(KEY_FILE);
  const slugs = isFirstIndexNowDeploy ? publishedBlogSlugs() : blogSlugsFromFiles(files);

  if (slugs.length === 0) return [];

  return [
    ...slugs.map((slug) => `${SITE_ORIGIN}/blog/${slug}/`),
    `${SITE_ORIGIN}/blog/`,
    `${SITE_ORIGIN}/rss.xml`,
    `${SITE_ORIGIN}/sitemap.xml`
  ];
}

export const onSuccess = async ({ constants, utils }) => {
  if (constants.IS_LOCAL || process.env.CONTEXT !== 'production') {
    console.log('IndexNow: 운영 배포가 아니므로 URL 전송을 생략합니다.');
    return;
  }

  if (!existsSync(KEY_FILE)) {
    console.warn('IndexNow: 소유권 확인용 키 파일이 없어 URL 전송을 생략합니다.');
    return;
  }

  const urls = urlsToSubmit(changedFiles());
  if (urls.length === 0) {
    console.log('IndexNow: 변경된 블로그 URL이 없습니다.');
    return;
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: SITE_HOST,
        key: INDEXNOW_KEY,
        keyLocation: KEY_LOCATION,
        urlList: urls
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${await response.text()}`.trim());
    }

    console.log(`IndexNow: ${urls.length}개 URL을 전송했습니다.`);
    utils.status.show({
      title: 'IndexNow',
      summary: `${urls.length}개 변경 URL 전송 완료`,
      text: urls.join('\n')
    });
  } catch (error) {
    console.warn(`IndexNow 전송에 실패했습니다. 다음 배포에서 다시 시도할 수 있습니다. ${error.message}`);
  }
};
