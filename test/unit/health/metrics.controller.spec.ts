import { Test } from '@nestjs/testing';
import { MetricsController } from '../../../src/health/metrics.controller';

describe('MetricsController', () => {
  let controller: MetricsController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MetricsController],
    }).compile();
    controller = module.get(MetricsController);
  });

  it('should return Prometheus text format from /metrics', async () => {
    const output = await controller.getMetrics();
    expect(typeof output).toBe('string');
    // Prometheus text format starts with # HELP or contains metric names
    expect(output.length).toBeGreaterThan(0);
    expect(output).toMatch(/gpt_image_mcp_|nodejs_/);
  });

  it('should include custom image generation counter metric', async () => {
    const output = await controller.getMetrics();
    expect(output).toContain('gpt_image_mcp_image_generations_total');
  });

  it('should include custom MCP request counter metric', async () => {
    const output = await controller.getMetrics();
    expect(output).toContain('gpt_image_mcp_mcp_requests_total');
  });
});
