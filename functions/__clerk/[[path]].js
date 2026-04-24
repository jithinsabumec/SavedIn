// Cloudflare Pages Function: Clerk FAPI proxy
// Routes all /__clerk/* requests to Clerk's Frontend API
// Required because clerk.savedin.pages.dev CNAME cannot be set on pages.dev

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Strip the /__clerk prefix and forward to Clerk's FAPI
  const clerkFapiUrl = new URL(
    url.pathname.replace(/^\/__clerk/, '') + url.search,
    'https://frontend-api.clerk.services'
  );

  // Forward the request
  const clerkResponse = await fetch(clerkFapiUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  });

  // Return the response with CORS headers
  const response = new Response(clerkResponse.body, clerkResponse);
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, clerk-backend-api-url, clerk-db-jwt, x-clerk-auth-reason, x-clerk-auth-message');

  return response;
}
