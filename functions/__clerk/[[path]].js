// Cloudflare Pages Function: Clerk FAPI proxy
// Routes /__clerk/* to Clerk's Frontend API
// Bypasses the need for clerk.savedin.pages.dev CNAME (unverifiable on pages.dev)

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight immediately
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, Clerk-Backend-Api-Url, X-Clerk-Auth-Reason',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Strip /__clerk prefix
  const proxyPath = url.pathname.replace(/^\/__clerk/, '') || '/';
  const targetUrl = new URL(proxyPath + url.search, 'https://frontend-api.clerk.services');

  // Build forwarded headers - let fetch() handle Host automatically
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete('host');
  forwardedHeaders.delete('cf-connecting-ip');
  forwardedHeaders.delete('cf-ipcountry');
  forwardedHeaders.delete('cf-ray');
  forwardedHeaders.delete('cf-visitor');
  forwardedHeaders.delete('x-forwarded-for');
  forwardedHeaders.delete('x-forwarded-proto');

  const upstreamResponse = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: forwardedHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    redirect: 'follow',
  });

  // Clone response with CORS headers added
  const responseHeaders = new Headers(upstreamResponse.headers);
  const origin = request.headers.get('Origin');
  responseHeaders.set('Access-Control-Allow-Origin', origin || '*');
  responseHeaders.set('Access-Control-Allow-Credentials', 'true');
  responseHeaders.set('Vary', 'Origin');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
