/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@gravitykit/drip-mcp-server",
    "@modelcontextprotocol/sdk",
  ],
};

export default nextConfig;
