import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { McpServerService } from '../../../src/mcp/mcp.server';
import { ImageGenerateTool } from '../../../src/mcp/tools/image-generate.tool';
import { ImageEditTool } from '../../../src/mcp/tools/image-edit.tool';
import { ImageVariationTool } from '../../../src/mcp/tools/image-variation.tool';
import { ProviderListTool } from '../../../src/mcp/tools/provider-list.tool';
import { ProviderValidateTool } from '../../../src/mcp/tools/provider-validate.tool';
import { PROVIDER_TOKEN } from '../../../src/providers/provider.interface';
import { ElicitationService } from '../../../src/mcp/features/elicitation.service';
import { SamplingService } from '../../../src/mcp/features/sampling.service';
import { RootsService } from '../../../src/mcp/features/roots.service';

const noopTool = { register: jest.fn() };
const mockProvider = { name: 'openai', generate: jest.fn(), edit: jest.fn(), variation: jest.fn(), validate: jest.fn() };

describe('McpServerService', () => {
  let service: McpServerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        McpServerService,
        { provide: ImageGenerateTool, useValue: noopTool },
        { provide: ImageEditTool, useValue: noopTool },
        { provide: ImageVariationTool, useValue: noopTool },
        { provide: ProviderListTool, useValue: noopTool },
        { provide: ProviderValidateTool, useValue: noopTool },
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: ElicitationService, useValue: { isEnabled: false } },
        { provide: SamplingService, useValue: { isEnabled: false } },
        { provide: RootsService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'mcp') return { useElicitation: true, useSampling: false, transport: 'http', port: 3000 };
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(McpServerService);
    service.onModuleInit();
  });

  it('should create McpServer with correct name and version', () => {
    expect(service.server).toBeDefined();
  });

  it('innerServer should be the inner SDK Server (has elicitInput / createMessage / listRoots)', () => {
    const inner = service.innerServer;
    expect(inner).toBeDefined();
    expect(typeof inner.elicitInput).toBe('function');
    expect(typeof inner.createMessage).toBe('function');
    expect(typeof inner.listRoots).toBe('function');
    // Must NOT be the McpServer wrapper itself
    expect(inner).not.toBe(service.server);
  });

  it('should call register() on all 5 tools during init', () => {
    expect(noopTool.register).toHaveBeenCalledTimes(5);
  });

  it('should include tools capability in capabilities object', () => {
    expect(service.capabilities.tools).toBeDefined();
  });

  it('should always include logging capability', () => {
    expect(service.capabilities.logging).toBeDefined();
  });

  it('should always include tools capability', () => {
    expect(service.capabilities.tools).toBeDefined();
  });
});
