// Cloudflare Pages Function: Clerk FAPI proxy
// Routes /__clerk/* to Clerk's production Frontend API
// Uses Cloudflare fetch cf options to handle SSL compatibility

const PROXY_URL = 'https://savedin.pages.dev/__clerk';
const CLERK_FAPI = 'https://frontend-api.clerk.services';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Strip /__clerk prefix and build target URL
  const proxyPath = url.pathname.replace(/^\/__clerk/, '') || '/';
  const targetUrl = CLERK_FAPI + proxyPath + url.search;

  // Build forwarded headers
  const forwardHeaders = new Headers();
  for (const [key, val] of request.headers.entries()) {
    const k = key.toLowerCase();
    // Strip Cloudflare-injected headers to avoid conflicts
    if (['host', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cf-connecting-ip',
         'x-real-ip', 'x-forwarded-host'].includes(k)) continue;
    forwardHeaders.set(key, val);
  }

  // Required Clerk proxy headers per docs
  forwardHeaders.set('Clerk-Proxy-Url', PROXY_URL);
  forwardHeaders.set('X-Forwarded-For',
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') || '');
  if (env.CLERK_SECRET_KEY) {
    forwardHeaders.set('Clerk-Secret-Key', env.CLERK_SECRET_KEY);
  }

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    redirect: 'follow',
    // Cloudflare Workers cf options for SSL compatibility
    cf: {
      minTlsVersion: '1.0',
    },
  });

  const respHeaders = new Headers(upstream.headers);
  respHeaders.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
  respHeaders.set('Access-Control-Allow-Credentials', 'true');
  respHeaders.set('Vary', 'Origin');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
