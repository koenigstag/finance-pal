import { Controller, Delete, Get, Post, Req, Res, UseFilters } from '@nestjs/common';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Request, Response } from 'express';
import { ApiKeyAuthScope } from '../../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../../_core/authn/request-user';
import { requireApiKey } from '../../_core/authn/require-api-key';
import { MCP_PATH } from '../../oauth/oauth-settings';
import { FinanceMcpService } from './finance-mcp.service';
import { McpUnauthorizedFilter } from './mcp-unauthorized.filter';

// The headers the transport reads; the rest of the request is Express's business.
const FORWARDED_HEADERS = ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];

/**
 * The MCP endpoint (Model Context Protocol, Streamable HTTP): where an AI assistant reads a group's
 * money with the tools FinanceMcpService offers. Callers authenticate like the external API's, with
 * an API key — one made in the app, or the one OAuth sign-in hands an assistant — and any valid key
 * gets in: each tool needs its own scope, and a key sees only the tools it has scopes for.
 *
 * Stateless: every request gets its own server and transport, answers in plain JSON, and nothing
 * outlives it. That keeps the request inside the one RLS transaction RlsContextInterceptor holds
 * open for it — the tools run before the handler returns — and leaves nothing to hold on to between
 * requests, so there is no stream to open (GET) or session to end (DELETE).
 */
@Controller()
@UseFilters(McpUnauthorizedFilter)
export class McpController {
  constructor(private readonly mcp: FinanceMcpService) {}

  @ApiKeyAuthScope(null)
  @Post(MCP_PATH)
  async post(@Req() request: Request, @Res() response: Response, @CurrentApiKey() apiKey?: RequestApiKey): Promise<void> {
    const server = await this.mcp.serverFor(requireApiKey(apiKey));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      // Express has read the body already; the transport is handed it parsed, and the rest as a
      // web Request, which is all it takes.
      const answer = await transport.handleRequest(webRequestOf(request), { parsedBody: request.body });
      response.status(answer.status);
      answer.headers.forEach((value, name) => response.setHeader(name, value));
      response.send(Buffer.from(await answer.arrayBuffer()));
    } finally {
      await server.close();
    }
  }

  @ApiKeyAuthScope(null)
  @Get(MCP_PATH)
  stream(@Res() response: Response): void {
    methodNotAllowed(response);
  }

  @ApiKeyAuthScope(null)
  @Delete(MCP_PATH)
  endSession(@Res() response: Response): void {
    methodNotAllowed(response);
  }
}

function webRequestOf(request: Request): globalThis.Request {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') {
      headers.set(name, value);
    }
  }
  return new globalThis.Request(new URL(request.originalUrl, 'http://localhost'), { method: request.method, headers });
}

// What the MCP specification asks of a server that offers no stream and keeps no session.
function methodNotAllowed(response: Response): void {
  response
    .status(405)
    .setHeader('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server answers POST requests only' }, id: null });
}
