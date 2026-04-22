import { Module } from '@nestjs/common';
import { McpServerService } from './mcp.server';
import { McpHttpController } from './transport/http.controller';
import { McpStdioBootstrap } from './transport/stdio.bootstrap';
import { ImageGenerateTool } from './tools/image-generate.tool';
import { ImageEditTool } from './tools/image-edit.tool';
import { ImageVariationTool } from './tools/image-variation.tool';
import { ProviderListTool } from './tools/provider-list.tool';
import { ProviderValidateTool } from './tools/provider-validate.tool';
import { ElicitationService } from './features/elicitation.service';
import { SamplingService } from './features/sampling.service';
import { RootsService } from './features/roots.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [McpHttpController],
  providers: [
    McpServerService,
    McpStdioBootstrap,
    // Tools
    ImageGenerateTool,
    ImageEditTool,
    ImageVariationTool,
    ProviderListTool,
    ProviderValidateTool,
    // MCP features
    ElicitationService,
    SamplingService,
    RootsService,
  ],
  exports: [McpServerService],
})
export class McpModule {}
