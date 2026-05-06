/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@gravitykit/drip-mcp-server",
    "@modelcontextprotocol/sdk",
  ],
};

export default nextConfig;
