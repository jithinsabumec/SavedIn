// Cloudflare Pages Function: Clerk FAPI proxy
// Routes /__clerk/* to Clerk's Frontend API
// Required headers per Clerk proxy docs: Clerk-Proxy-Url, Clerk-Secret-Key, X-Forwarded-For

const PROXY_URL = 'https://savedin.pages.dev/__clerk';
// Target: frontend-api.clerk.dev (per Clerk docs for satellite/proxy setup)
const CLERK_FAPI = 'https://frontend-api.clerk.dev';

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

  // Build forwarded headers, removing Cloudflare-injected headers
  const forwardHeaders = new Headers();
  for (const [key, val] of request.headers.entries()) {
    const k = key.toLowerCase();
    if (['host', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cf-connecting-ip'].includes(k)) continue;
    forwardHeaders.set(key, val);
  }

  // Required Clerk proxy headers
  forwardHeaders.set('Clerk-Proxy-Url', PROXY_URL);
  forwardHeaders.set('X-Forwarded-For', request.headers.get('cf-connecting-ip') || '');
  if (env.CLERK_SECRET_KEY) {
    forwardHeaders.set('Clerk-Secret-Key', env.CLERK_SECRET_KEY);
  }

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    redirect: 'follow',
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
