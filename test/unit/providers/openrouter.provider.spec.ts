import { describe, expect, it, mock } from 'bun:test';
import { OpenRouterImageProvider } from '../../../src/providers/openrouter.provider';
import { ImageProviderError } from '../../../src/providers/provider.interface';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const response = (body: unknown, status=200, headers: Record<string,string>={}) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', ...headers } });
const make = (fetchImpl: typeof fetch, model?: string) => new OpenRouterImageProvider({ apiKey:'or-secret', defaultModel:model, fetchImpl });

describe('OpenRouterImageProvider', () => {
  it('generates Nano Banana through POST /images with resolution and aspect ratio', async () => {
    const f=mock(async (_u: string|URL|Request, _init?:RequestInit)=>response({created:1,data:[{b64_json:PNG,media_type:'image/png'}]}));
    const out=await make(f as typeof fetch).generate({prompt:'x',model:'google/gemini-3.1-flash-image',n:1,resolution:'2K',aspect_ratio:'16:9'});
    expect(out[0].model).toBe('google/gemini-3.1-flash-image');
    expect(f.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({resolution:'2K',aspect_ratio:'16:9'}));
    expect((f.mock.calls[0][1]?.headers as Record<string,string>).Authorization).toBe('Bearer or-secret');
  });

  it('generates MAI with aspect ratio and rejects resolution or n>1 before network', async () => {
    const f=mock(async ()=>response({data:[{b64_json:PNG,media_type:'image/png'}]})); const p=make(f as typeof fetch,'microsoft/mai-image-2.5');
    await expect(p.generate({prompt:'x',model:'microsoft/mai-image-2.5',resolution:'2K'})).rejects.toThrow(/does not advertise resolution/);
    await expect(p.generate({prompt:'x',model:'microsoft/mai-image-2.5',n:2})).rejects.toThrow(/n=1/);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps edit images to data-URI input_references and enforces per-model limits', async () => {
    const f=mock(async ()=>response({data:[{b64_json:PNG,media_type:'image/png'}]})); const p=make(f as typeof fetch);
    await p.edit({image:PNG,prompt:'edit',model:'google/gemini-3.1-flash-image',aspect_ratio:'1:1'});
    const body=JSON.parse(String(f.mock.calls[0][1]?.body));
    expect(body.input_references[0].image_url.url).toStartWith('data:image/png;base64,');
    await expect(p.edit({images:[PNG,PNG],prompt:'edit',model:'microsoft/mai-image-2.5'})).rejects.toThrow(/at most 1/);
  });

  it('discovers supported models and validates the default', async () => {
    const f=mock(async ()=>response({data:[{id:'google/gemini-3.1-flash-image'},{id:'other'}]})); const p=make(f as typeof fetch);
    expect(await p.listAvailableModels()).toEqual(['google/gemini-3.1-flash-image']);
    expect((await p.validate()).valid).toBe(true);
  });

  it.each([[401,'AUTHENTICATION_FAILED',false],[402,'INSUFFICIENT_CREDITS',false],[429,'RATE_LIMITED',true],[502,'UPSTREAM_GENERATION_FAILED',true]] as const)(
    'maps HTTP %i to %s', async(status,code,retryable)=>{ const f=mock(async()=>response({error:{code:status,message:'failure'}},status,{'x-request-id':'r1'}));
      let caught: unknown; try{await make(f as typeof fetch).generate({prompt:'x',model:'google/gemini-3.1-flash-image'});}catch(e){caught=e;}
      expect(caught).toBeInstanceOf(ImageProviderError); expect((caught as ImageProviderError).code).toBe(code); expect((caught as ImageProviderError).retryable).toBe(retryable); expect((caught as ImageProviderError).requestId).toBe('r1'); }
  );

  it('rejects variation without network', async()=>{const f=mock(async()=>response({})); await expect(make(f as typeof fetch).variation({image:PNG})).rejects.toThrow(/not supported/); expect(f).not.toHaveBeenCalled();});
});
