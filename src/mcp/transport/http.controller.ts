import { Controller, Post, Req, Res, UseGuards, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServerService } from '../mcp.server';
import { AuthGuard } from '../../security/auth.guard';
import { RateLimitGuard } from '../../security/rate-limit.guard';
import { maskSecret } from '../../security/sanitise';

@Controller('mcp')
@UseGuards(AuthGuard, RateLimitGuard)
export class McpHttpController {
  private readonly logger = new Logger(McpHttpController.name);

  constructor(private readonly mcpService: McpServerService) {}

  @Post()
  async handleMcp(@Req() req: Request, @Res() res: Response) {
    // Create a new stateless transport per request (avoids ID collisions)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close().catch((err: unknown) => {
        this.logger.warn(`Transport close error: ${maskSecret(String(err))}`);
      });
    });

    try {
      await this.mcpService.server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(`MCP request error: ${maskSecret(String(err))}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
