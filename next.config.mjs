/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-agent-sdk-linux-x64",
    "@gravitykit/drip-mcp-server",
    "@modelcontextprotocol/sdk",
  ],
  outputFileTracingIncludes: {
    "/api/run": [
      "./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*",
      "./node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-x64*/**/*",
      "./node_modules/@gravitykit/drip-mcp-server/**/*",
      "./node_modules/.pnpm/@gravitykit+drip-mcp-server*/**/*",
    ],
  },
};

export default nextConfig;
