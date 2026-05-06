// Cross-platform bootstrap for the GravityKit Drip MCP server.
// Their entrypoint guards run() with a file:// vs argv[1] equality check
// that fails on Windows, so we import the class and call run() directly.
import { DripMCPServer } from "@gravitykit/drip-mcp-server/src/index.js";

const server = new DripMCPServer();
server.run().catch((err) => {
  console.error("Drip MCP failed to start:", err);
  process.exit(1);
});
