import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co wss://play.ws.autodarts.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
    ] },{source:'/camera-device',headers:[
      {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=()'},
      {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
      {key:'Cross-Origin-Embedder-Policy',value:'require-corp'},
    ]},{source:'/camera-engine/:path*',headers:[
      {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=()'},
      {key:'X-Frame-Options',value:'SAMEORIGIN'},
      {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
      {key:'Cross-Origin-Embedder-Policy',value:'require-corp'},
      {key:'Cross-Origin-Resource-Policy',value:'same-origin'},
      {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'"},
    ]}];
  },
};
export default config;
