/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8010'

/**
 * NFR-SEC-04 (found by the nightly ZAP scan): the built app is served with the same kind of
 * security headers the API sends. Production hosting (CDN / reverse proxy) must send these
 * too - this list is the reference. Not applied to the dev server: its hot-reload preamble is
 * an inline script, which this CSP rightly forbids.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'", // React style={{...}} (e.g. the rating bars)
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api calls in dev; no CORS juggling in the browser.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    headers: SECURITY_HEADERS,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/test/**', 'src/main.tsx'] },
  },
})
