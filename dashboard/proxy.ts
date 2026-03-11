import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://backend:8000"

/**
 * Proxy /_allauth/* API routes to Django backend.
 *
 * /accounts/* is handled by a Route Handler (app/accounts/[...path]/route.ts)
 * instead of here because OAuth callbacks need Set-Cookie forwarding, and
 * the edge runtime strips Set-Cookie from proxy/middleware responses.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname.startsWith("/_allauth/")) {
    const destination = new URL(`${pathname}${search}`, BACKEND_URL)
    return NextResponse.rewrite(destination)
  }
}

export const config = {
  matcher: ["/_allauth/:path*"],
}
