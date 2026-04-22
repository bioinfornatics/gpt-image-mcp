import { Controller, Get, Header } from '@nestjs/common';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

// Collect default Node.js metrics (memory, CPU, etc.)
collectDefaultMetrics({ prefix: 'gpt_image_mcp_' });

// Custom metrics
export const imageGenerationCounter = new Counter({
  name: 'gpt_image_mcp_image_generations_total',
  help: 'Total number of image generation requests',
  labelNames: ['model', 'provider', 'status'],
});

export const imageGenerationDuration = new Histogram({
  name: 'gpt_image_mcp_image_generation_duration_seconds',
  help: 'Image generation request duration in seconds',
  labelNames: ['model', 'provider'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
});

export const mcpRequestCounter = new Counter({
  name: 'gpt_image_mcp_mcp_requests_total',
  help: 'Total MCP requests received',
  labelNames: ['method', 'status'],
});

export const rateLimitCounter = new Counter({
  name: 'gpt_image_mcp_rate_limit_hits_total',
  help: 'Total rate limit rejections',
  labelNames: ['client_ip'],
});

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
