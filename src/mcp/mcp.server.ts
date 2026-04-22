import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConfigService } from '@nestjs/config';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageVariationTool } from './tools/image-variation.tool';
import { ProviderListTool } from './tools/provider-list.tool';
import { ProviderValidateTool } from './tools/provider-validate.tool';
import type { AppConfig } from '../config/app.config';

@Injectable()
export class McpServerService implements OnModuleInit {
  private readonly logger = new Logger(McpServerService.name);
  public readonly server: McpServer;

  constructor(
    private readonly configService: ConfigService,
    private readonly imageGenerateTool: ImageGenerateTool,
    private readonly imageEditTool: ImageEditTool,
    private readonly imageVariationTool: ImageVariationTool,
    private readonly providerListTool: ProviderListTool,
    private readonly providerValidateTool: ProviderValidateTool,
  ) {
    this.server = new McpServer({
      name: 'gpt-image-mcp',
      version: '0.1.0',
    });
  }

  onModuleInit() {
    this.registerTools();
    this.logger.log('MCP server initialised with 5 tools');
  }

  private registerTools() {
    this.imageGenerateTool.register(this.server);
    this.imageEditTool.register(this.server);
    this.imageVariationTool.register(this.server);
    this.providerListTool.register(this.server);
    this.providerValidateTool.register(this.server);
  }

  get capabilities() {
    const mcpConfig = this.configService.get<AppConfig['mcp']>('mcp')!;
    return {
      tools: {},
      ...(mcpConfig.useElicitation ? { elicitation: {} } : {}),
      logging: {},
    };
  }
}
