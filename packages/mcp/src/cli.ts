/**
 * Sprixy MCP server (stdio). Usage with Claude Code:
 *   claude mcp add sprixy --env SPRIXY_URL=http://localhost:3210 --env SPRIXY_TOKEN=spx_xxx -- npx -y @sprixy/mcp
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SprixyClient } from '@sprixy/client';
import { createSprixyMcpServer } from './server.js';

const baseUrl = process.env.SPRIXY_URL ?? 'http://localhost:3210';
const token = process.env.SPRIXY_TOKEN;
if (!token) {
  process.stderr.write('SPRIXY_TOKEN is required (create one in Sprixy → Settings → API tokens)\n');
  process.exit(1);
}

const server = createSprixyMcpServer(new SprixyClient({ baseUrl, token }), {
  allowFileWrite: process.env.SPRIXY_MCP_ALLOW_WRITE !== 'false',
  async writeFile(p, data) {
    const abs = path.resolve(p);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return abs;
  },
});

await server.connect(new StdioServerTransport());
process.stderr.write(`Sprixy MCP connected to ${baseUrl}\n`);
