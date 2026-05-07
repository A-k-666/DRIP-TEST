/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@gravitykit/drip-mcp-server",
    "@modelcontextprotocol/sdk",
  ],
  outputFileTracingIncludes: {
    "/api/run": [
      "./src/drip-mcp-bootstrap.mjs",
      "./node_modules/@gravitykit/drip-mcp-server/**/*",
      "./node_modules/.pnpm/@gravitykit+drip-mcp-server*/**/*",
    ],
  },
};

export default nextConfig;
