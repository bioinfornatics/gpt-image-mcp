#!/usr/bin/env node
// reflect-metadata MUST be the absolute first import.
// NestJS decorators (@Controller, @Post, @Injectable, etc.) call
// Reflect.defineMetadata() at module-load time. If reflect-metadata hasn't
// run yet the decorator crashes with "undefined is not an object".
// This is safe with both `node dist/main.js` and `bun run src/main.ts`
// because Node/Bun process `import` statements sequentially within a file
// before any later imports are resolved.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import express from 'express';
import { resolveSecrets } from './config/secret-loader';

async function bootstrap() {
  // Resolve secrets BEFORE NestJS bootstrap so Joi validation sees the real values.
  // Supports: *_FILE env vars (Docker/K8s secrets), OS keychain (keytar), plain env vars.
  await resolveSecrets();

  const logger = new Logger('Bootstrap');

  // In stdio mode stdout is the MCP JSON-RPC wire — any non-JSON bytes break
  // the protocol. Override NestJS ConsoleLogger to write to stderr instead.
  const isStdio = (process.env['MCP_TRANSPORT'] ?? 'http') === 'stdio';

  let nestLogger: any;
  if (isStdio) {
    const { ConsoleLogger } = await import('@nestjs/common');
    class StderrLogger extends ConsoleLogger {
      protected override printMessages(
        messages: unknown[],
        context?: string,
        logLevel?: import('@nestjs/common').LogLevel,
        _writeStreamType?: 'stdout' | 'stderr',
      ) {
        // Force all output to stderr — stdout is reserved for MCP JSON-RPC
        super.printMessages(messages, context, logLevel, 'stderr');
      }
    }
    nestLogger = new StderrLogger();
  } else {
    nestLogger = ['error', 'warn', 'log', 'debug', 'verbose'];
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: nestLogger,
    bufferLogs: false,
  });

  app.set('trust proxy', 1); // Trust first proxy — required for correct IP in rate limiting

  // Parse JSON bodies for MCP requests
  app.use(express.json({ limit: '50mb' }));

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

bootstrap().catch((err: unknown) => {
  // Use maskSecret to avoid leaking API keys in startup crash messages
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : '';
  // Import is synchronous at this point — sanitise inline
  const masked = msg.replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***')
                    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer ***')
                    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '***-guid-***')
                    .replace(/\b[A-Za-z0-9]{32,}\b/g, '***');
  console.error('Fatal startup error:', masked);
  if (stack) {
    console.error(stack.replace(/\b[A-Za-z0-9]{32,}\b/g, '***'));
  }
  process.exit(1);
});
