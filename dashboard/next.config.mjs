/** @type {import('next').NextConfig} */

const backend = process.env.BACKEND_INTERNAL_URL
if (!backend) {
  throw new Error(
    "BACKEND_INTERNAL_URL is required (e.g. http://backend:8000). " +
    "Set it in docker-compose.yml or your shell environment."
  )
}

const nextConfig = {
  output: "standalone",

  // Next.js strips trailing slashes by default (308). Django requires them
  // (301 APPEND_SLASH). Disable the Next.js behavior so middleware can proxy
  // backend routes with their original path intact.
  skipTrailingSlashRedirect: true,

  // Backend route proxying moved to middleware.ts — rewrites internally follow
  // Django's APPEND_SLASH 301 redirects, losing the rewrite context and causing
  // redirect loops. Middleware rewrites preserve the full URL without following.
}

export default nextConfig
