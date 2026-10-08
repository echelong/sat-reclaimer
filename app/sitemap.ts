import type { MetadataRoute } from 'next';

/**
 * Both real routes are listed. The console is included because it is a working
 * product surface, not a private page, and it has its own title and description.
 * The base URL must be set with `NEXT_PUBLIC_SITE_URL` before launch; see
 * docs/PUBLIC_BETA.md.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteUrl}/app`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];
}
