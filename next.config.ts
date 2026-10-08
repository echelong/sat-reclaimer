import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * The app is static: no server routes, no database, no user content, no
 * analytics, no third-party scripts, and no `dangerouslySetInnerHTML` anywhere.
 * That makes a genuinely restrictive policy possible, and it is written to fail
 * closed rather than to be convenient:
 *
 *  - `default-src 'none'` — nothing loads unless it is allowed explicitly.
 *  - `connect-src` is exactly the hosts this app talks to: the public Bitcoin
 *    broadcast and status endpoints declared in `src/lib/broadcast.ts`. Nothing
 *    else can be reached, so an injected `fetch` to an attacker-controlled host is
 *    blocked by the browser rather than by a code review.
 *  - `frame-ancestors 'none'` and `frame-src 'none'` — the wallet approval flow
 *    must never be embedded, framed or overlayable by another origin.
 *  - `object-src`, `base-uri`, `form-action`, `worker-src` all `'none'` — no
 *    plugins, no base-tag hijack, no exfiltration by form post, no workers.
 *
 * Two allowances are required and are deliberate:
 *
 *  - **`script-src 'unsafe-inline'`.** Next.js streams its server-rendered flight
 *    data as inline `<script>self.__next_f.push(...)</script>` blocks. Without
 *    this the app does not hydrate at all in production — verified against the
 *    generated HTML in `.next/server/app/index.html`, which contains those inline
 *    blocks. A nonce-based policy is the documented alternative, but it requires
 *    middleware and forces every route to render dynamically, which is a real cost
 *    for a static deployment. The residual risk is bounded by the other
 *    directives: there is no user-generated content and no third-party script in
 *    this app, so there is no injection point for an inline script to arrive
 *    through, and `connect-src` still stops it exfiltrating anywhere.
 *  - **`style-src 'unsafe-inline'`.** Next inlines the critical CSS for
 *    server-rendered pages. No style value is ever user-controlled.
 *
 * Verified in the production-build browser QA pass, which reports CSP violations
 * as console errors: see `docs/RELEASE_GATES.md`.
 */
const BROADCAST_ORIGINS = [
  'https://mempool.space',
  'https://blockstream.info',
  'https://mempool.emzy.de',
];

function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${BROADCAST_ORIGINS.join(' ')}${isDev ? ' ws: http://localhost:*' : ''}`,
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

const STATIC_PAGE_CACHE = [
  { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, must-revalidate' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework version. There is no security benefit in
  // telling a scanner which Next release to try.
  poweredByHeader: false,

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy(isDev) },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: [
              'accelerometer=()',
              'camera=()',
              'geolocation=()',
              'gyroscope=()',
              'magnetometer=()',
              'microphone=()',
              'payment=()',
              'usb=()',
            ].join(', '),
          },
          // The wallet approval flow must not be reachable from an opener, and
          // these resources must not be embeddable by another origin.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        // The console handles real-value decisions and holds a signed transaction
        // in memory. Never let a shared cache keep a rendered copy of it.
        source: '/app',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
      // The landing page and the policy pages are static text. Next's default for
      // a prerendered route is `s-maxage=31536000`, which lets a shared cache keep
      // serving an HTML document that references chunk URLs a later deploy has
      // removed. An hour at the edge with revalidation is enough for a page that
      // changes at deploy time, and the hashed assets keep their long TTLs.
      { source: '/', headers: STATIC_PAGE_CACHE },
      { source: '/privacy', headers: STATIC_PAGE_CACHE },
      { source: '/terms', headers: STATIC_PAGE_CACHE },
      { source: '/risk', headers: STATIC_PAGE_CACHE },
      { source: '/open-source', headers: STATIC_PAGE_CACHE },
    ];
  },
};

export default nextConfig;
