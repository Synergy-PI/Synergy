import type { NextConfig } from 'next';

// Cabeçalhos de segurança aplicados a todas as respostas.
// A Cloudflare adiciona outros (HSTS, etc.) na borda; aqui garantimos o mínimo mesmo sem ela.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // Gera .next/standalone com um server.js mínimo — usado pelo Dockerfile.
  output: 'standalone',
  poweredByHeader: false,
  // Leitores de documentos dos editais (src/lib/tenders/document-text.ts): grandes e feitos para Node.js,
  // são carregados direto do node_modules em vez de entrarem no pacote do servidor.
  serverExternalPackages: ['unpdf', 'word-extractor', 'fflate'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
