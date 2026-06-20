import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    category: z.enum(['고객 사례', '마케팅 인사이트']).default('마케팅 인사이트'),
    tags: z.array(z.string()).default([]),
    thumbnail: z.string().default(''),
    originalUrl: z.string().default(''),
    draft: z.boolean().default(false)
  })
});

export const collections = { blog };
