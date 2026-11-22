import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SprixyClient } from '@sprixy/client';
import { createSprixyMcpServer } from '@sprixy/mcp';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless) at /mcp.
 *   claude mcp add --transport http sprixy https://your-host/mcp --header "Authorization: Bearer spx_…"
 * Tool calls are executed against this same server through Fastify's in-process injection,
 * authenticated with the caller's bearer token.
 */
export async function mcpRoutes(app: FastifyInstance) {
  const handler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!req.user) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: send Authorization: Bearer <Sprixy API token>' }, id: null });
    }
    const auth = req.headers.authorization ?? '';
    const client = new SprixyClient({
      baseUrl: `${req.protocol}://${req.hostname}`,
      transport: async ({ method, path, body, headers }) => {
        const res = await app.inject({ method: method as 'GET', url: path, payload: body === undefined ? undefined : (body as object), headers: { ...headers, authorization: auth } });
        const ct = String(res.headers['content-type'] ?? '');
        const isJson = ct.includes('application/json');
        return {
          status: res.statusCode,
          body: isJson ? res.json() : new Uint8Array(res.rawPayload),
          headers: { 'content-type': ct, 'content-disposition': String(res.headers['content-disposition'] ?? '') },
        };
      },
    });
    const server = createSprixyMcpServer(client, { allowFileWrite: false });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };
  app.post('/mcp', { schema: { hide: true } }, handler);
  app.get('/mcp', { schema: { hide: true } }, async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server: use POST)' }, id: null }));
  app.delete('/mcp', { schema: { hide: true } }, async (_req, reply) => reply.code(405).send());
}
