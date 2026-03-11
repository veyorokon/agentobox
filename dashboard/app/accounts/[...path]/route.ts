/**
 * Proxy /accounts/* to Django backend (Node.js runtime).
 *
 * OAuth callbacks return 302 with Set-Cookie (session). Next.js strips
 * Set-Cookie from route handler responses on redirects. Instead of fighting
 * the framework, we complete the token exchange server-side:
 *
 *   1. Forward the OAuth callback to Django → get session cookie
 *   2. Use the session key to call /_internal/session-token
 *   3. Backend generates JWT from authenticated session
 *   4. Redirect to /auth/callback?token=<jwt>
 *
 * The callback page reads the token from the URL and stores it.
 */

export const runtime = "nodejs"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://backend:8000"

async function handler(request: Request) {
  const url = new URL(request.url)
  const destination = new URL(`${url.pathname}${url.search}`, BACKEND_URL)

  // Forward request to Django backend
  const headers = new Headers(request.headers)
  headers.set("x-forwarded-host", url.host)
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""))
  headers.set("host", new URL(BACKEND_URL).host)

  const backendRes = await fetch(destination.toString(), {
    method: request.method,
    headers,
    body: request.method !== "GET" ? await request.text() : undefined,
    redirect: "manual",
  })

  // Extract session cookie from Django's response
  const setCookies = backendRes.headers.getSetCookie()
  const sessionCookie = setCookies.find((c) => c.startsWith("agentobox_sessionid="))

  if (!sessionCookie || backendRes.status !== 302) {
    // Not a successful OAuth callback — forward the response as-is
    const location = backendRes.headers.get("location")
    if (location && backendRes.status === 302) {
      let loc = location
      loc = loc.replace(BACKEND_URL, url.origin)
      loc = loc.replace(/https?:\/\/dashboard:\d+/, url.origin)
      return Response.redirect(loc, 302)
    }
    return new Response(backendRes.body, {
      status: backendRes.status,
      headers: backendRes.headers,
    })
  }

  // Extract session value from "agentobox_sessionid=VALUE; ..."
  const sessionValue = sessionCookie.split(";")[0].split("=").slice(1).join("=")

  if (!sessionValue || sessionValue === '""' || sessionValue === "") {
    // Empty session = failed auth
    return Response.redirect(`${url.origin}/auth/callback?error=no_session`, 302)
  }

  // Exchange the session key for a JWT via the internal endpoint.
  // allauth's headless session endpoint doesn't emit JWT on plain reads —
  // it only exposes tokens during auth state transitions. This internal
  // endpoint generates a JWT directly from a valid authenticated session.
  const tokenRes = await fetch(`${BACKEND_URL}/_internal/session-token`, {
    headers: {
      "x-session-key": sessionValue,
    },
  })
  console.log(`[route-proxy] token endpoint: ${tokenRes.status}`)

  if (!tokenRes.ok) {
    return Response.redirect(`${url.origin}/auth/callback?error=no_session`, 302)
  }

  const json = await tokenRes.json()
  const token = json?.token ?? null

  if (!token) {
    return Response.redirect(`${url.origin}/auth/callback?error=no_session`, 302)
  }

  // Redirect to callback page with token — the page stores it in localStorage
  return Response.redirect(`${url.origin}/auth/callback?token=${encodeURIComponent(token)}`, 302)
}

export const GET = handler
export const POST = handler
