/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone only for Docker/Railway; Vercel uses its own build pipeline
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
}

export default nextConfig
