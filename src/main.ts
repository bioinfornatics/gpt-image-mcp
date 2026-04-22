import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    bufferLogs: false,
  });

  const configService = app.get(ConfigService);
  const transport = configService.get<string>('MCP_TRANSPORT', 'http');
  const port = configService.get<number>('PORT', 3000);

  if (transport === 'stdio') {
    // In stdio mode: connect MCP server via stdio transport
    const { McpStdioBootstrap } = await import('./mcp/transport/stdio.bootstrap');
    const bootstrap = app.get(McpStdioBootstrap);
    await app.init();
    await bootstrap.connect();
    logger.log('MCP server running via stdio transport');
  } else {
    // In HTTP mode: start Express with MCP endpoint
    await app.listen(port);
    logger.log(`MCP server listening on http://localhost:${port}/mcp`);
    logger.log(`Health check at http://localhost:${port}/health`);
  }
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
