import { Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/server';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageVariationTool } from './tools/image-variation.tool';
import { ProviderListTool } from './tools/provider-list.tool';
import { ProviderValidateTool } from './tools/provider-validate.tool';
import { getVersion } from '../cli/help';


@Injectable()
export class McpServerService {
  private readonly logger = new Logger(McpServerService.name);
  private stdioServer?: McpServer;

  constructor(
    private readonly imageGenerateTool: ImageGenerateTool,
    private readonly imageEditTool: ImageEditTool,
    private readonly imageVariationTool: ImageVariationTool,
    private readonly providerListTool: ProviderListTool,
    private readonly providerValidateTool: ProviderValidateTool,
  ) {}

  /** Create an isolated MCP server for one stateless HTTP request. */
  createServer(): McpServer {
    const server = new McpServer(
      { name: 'image-mcp', version: getVersion() },
      { capabilities: this.capabilities },
    );
    this.registerTools(server);
    this.logger.debug('MCP server initialised with 5 tools');
    return server;
  }

  /** Stdio owns one persistent server for the lifetime of the process. */
  get server(): McpServer {
    this.stdioServer ??= this.createServer();
    return this.stdioServer;
  }

  private registerTools(server: McpServer) {
    this.imageGenerateTool.register(server);
    this.imageEditTool.register(server);
    this.imageVariationTool.register(server);
    this.providerListTool.register(server);
    this.providerValidateTool.register(server);
  }

  /**
   * Returns what this server declares in initialize response.
   * Note: elicitation/sampling/roots are CLIENT capabilities the server checks at runtime.
   * The server itself advertises: tools, logging.
   */
  get capabilities() {
    return {
      tools: {},
      logging: {},
    };
  }
}
