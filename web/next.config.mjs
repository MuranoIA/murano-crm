/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // node-jose (decrypt do sync-cliente) não deve ser empacotado pelo webpack — carrega
  // do node_modules em runtime (Node), evita MODULE_NOT_FOUND no serverless.
  experimental: { serverComponentsExternalPackages: ["node-jose"] },
};
export default nextConfig;
