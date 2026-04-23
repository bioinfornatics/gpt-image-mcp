/* c8 ignore file -- stdio transport bootstrap: only active in MCP_TRANSPORT=stdio runtime */
import { Injectable, Logger } from '@nestjs/common';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServerService } from '../mcp.server';

@Injectable()
export class McpStdioBootstrap {
  private readonly logger = new Logger(McpStdioBootstrap.name);

  constructor(private readonly mcpService: McpServerService) {}

  async connect() {
    const transport = new StdioServerTransport();
    await this.mcpService.server.connect(transport);
    // In stdio mode, only log to stderr
    process.stderr.write('[gpt-image-mcp] Connected via stdio\n');
  }
}
