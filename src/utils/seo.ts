export const SITE_NAME = 'problem0';
export const SITE_NAME_KO = '프로블럼제로';
export const DEFAULT_SITE_URL = 'https://problem0.kr';
export const DEFAULT_TITLE = 'problem0 | 마케팅 문제를 0으로 만듭니다';
export const DEFAULT_DESCRIPTION =
  '프로블럼제로는 스타트업의 복잡한 마케팅 문제를 진단하고 퍼포먼스, 콘텐츠, 그로스 관점에서 필요한 해결책을 실행합니다.';
export const DEFAULT_OG_IMAGE = '/og.png';
export const TALLY_URL = 'https://tally.so/r/nGYRaO';

export const EXPERTISE = ['퍼포먼스 마케팅', '그로스 마케팅', '콘텐츠 마케팅', 'B2B 인터뷰', '마케팅 문제 해결'];
export const AUDIENCES = ['스타트업', 'SMB', 'B2B', 'B2C'];

export function getSiteUrl(site?: URL | string) {
  return new URL(site?.toString() || DEFAULT_SITE_URL);
}

export function absoluteUrl(path = '/', site?: URL | string) {
  const url = new URL(path, getSiteUrl(site));
  const isFile = /\.[a-z0-9]+$/i.test(url.pathname);

  if (!isFile && !url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }

  return url.toString();
}

export function normalizeMetaText(value = '') {
  return value
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildBreadcrumbList(items: Array<{ name: string; path: string }>, site?: URL | string) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path, site)
    }))
  };
}

export function buildBaseStructuredData(site?: URL | string) {
  const baseUrl = absoluteUrl('/', site);
  const organizationId = `${baseUrl}#organization`;
  const personId = `${baseUrl}#founder`;
  const serviceId = `${baseUrl}#professional-service`;
  const websiteId = `${baseUrl}#website`;

  return [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      name: SITE_NAME,
      alternateName: SITE_NAME_KO,
      url: baseUrl,
      inLanguage: 'ko-KR',
      publisher: { '@id': organizationId },
      about: { '@id': serviceId }
    },
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: SITE_NAME,
      alternateName: SITE_NAME_KO,
      url: baseUrl,
      logo: absoluteUrl('/favicon.ico', site),
      email: 'w2224459@gmail.com',
      founder: { '@id': personId },
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: 'w2224459@gmail.com',
        availableLanguage: ['ko']
      },
      knowsAbout: EXPERTISE,
      audience: AUDIENCES.map((name) => ({ '@type': 'Audience', name }))
    },
    {
      '@type': 'Person',
      '@id': personId,
      name: '정세현',
      jobTitle: 'Founder',
      worksFor: { '@id': organizationId },
      affiliation: { '@id': organizationId },
      knowsAbout: EXPERTISE,
      image: absoluteUrl('/images/jung-sehyeon-profile.png', site)
    },
    {
      '@type': 'ProfessionalService',
      '@id': serviceId,
      name: `${SITE_NAME} 마케팅 문제 해결 서비스`,
      alternateName: `${SITE_NAME_KO} 마케팅 문제 해결 서비스`,
      url: baseUrl,
      provider: { '@id': organizationId },
      founder: { '@id': personId },
      areaServed: 'KR',
      serviceType: EXPERTISE,
      audience: AUDIENCES.map((name) => ({ '@type': 'Audience', name })),
      description: 'problem0는 스타트업과 SMB의 복잡한 마케팅 문제를 진단하고 퍼포먼스, 그로스, 콘텐츠 관점에서 해결하는 1인 마케팅 문제 해결 에이전시입니다.',
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'problem0 서비스 영역',
        itemListElement: EXPERTISE.map((name) => ({
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name
          }
        }))
      }
    }
  ];
}

export function buildStructuredDataGraph(items: unknown[] = [], site?: URL | string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [...buildBaseStructuredData(site), ...items]
  };
}
