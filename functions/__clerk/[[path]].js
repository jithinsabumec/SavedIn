// Cloudflare Pages Function: Clerk FAPI proxy
// Routes /__clerk/* → https://frontend-api.clerk.services/*
// Needed because clerk.savedin.pages.dev CNAME cannot be verified on pages.dev

const CLERK_FAPI_HOST = 'frontend-api.clerk.services';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Strip /__clerk prefix, keep rest of path + query
  const clerkPath = url.pathname.replace(/^\/__clerk/, '') || '/';
  const targetUrl = `https://${CLERK_FAPI_HOST}${clerkPath}${url.search}`;

  // Build new headers with correct Host
  const newHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    // Skip the original Host header — fetch() sets it from the URL
    if (key.toLowerCase() === 'host') continue;
    newHeaders.set(key, value);
  }
  newHeaders.set('host', CLERK_FAPI_HOST);

  const clerkResponse = await fetch(targetUrl, {
    method: request.method,
    headers: newHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'follow',
  });

  const response = new Response(clerkResponse.body, {
    status: clerkResponse.status,
    statusText: clerkResponse.statusText,
    headers: clerkResponse.headers,
  });

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Credentials', 'true');

  return response;
}
