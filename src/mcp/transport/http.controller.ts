import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServerService } from '../mcp.server';
import { AuthGuard } from '../../security/auth.guard';
import { RateLimitGuard } from '../../security/rate-limit.guard';
import { maskSecret } from '../../security/sanitise';
import { ENTRA_AUTH, type ValidatedEntraAuth } from '../../security/entra-token-validator.service';
import { RequestIdentityContextService } from '../../security/request-identity-context.service';
import { randomUUID } from 'node:crypto';
import { BearerAuthFilter } from '../../security/bearer-auth.filter';

@Controller('mcp')
@UseGuards(AuthGuard, RateLimitGuard)
@UseFilters(BearerAuthFilter)
export class McpHttpController {
  private readonly logger = new Logger(McpHttpController.name);

  constructor(
    private readonly mcpService: McpServerService,
    private readonly identityContext: RequestIdentityContextService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleMcp(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const server = this.mcpService.createServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([transport.close(), server.close()]);
      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(`MCP close error: ${maskSecret(String(result.reason))}`);
        }
      }
    };
    reply.raw.once('close', () => void close());

    try {
      const execute = async () => {
        await server.connect(transport);
        await transport.handleRequest(req.raw, reply.raw, req.body);
      };
      const auth = (req as FastifyRequest & { [ENTRA_AUTH]?: ValidatedEntraAuth })[ENTRA_AUTH];
      if (auth) {
        await this.identityContext.run(
          { ...auth.identity, correlationId: randomUUID() },
          auth.assertion,
          execute,
        );
      } else {
        await execute();
      }
    } catch (err) {
      this.logger.error(`MCP request error: ${maskSecret(String(err))}`);
      if (!reply.raw.headersSent) {
        reply.status(500).send({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
      await close();
    }
  }

  @Get()
  @HttpCode(405)
  getNotAllowed(@Res() reply: FastifyReply): void {
    this.sendMethodNotAllowed(reply);
  }

  @Delete()
  @HttpCode(405)
  deleteNotAllowed(@Res() reply: FastifyReply): void {
    this.sendMethodNotAllowed(reply);
  }

  private sendMethodNotAllowed(reply: FastifyReply): void {
    reply.status(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  }
}
