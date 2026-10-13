import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultChannelConfig, defaultSettings, type AttemptRecord, type GatewayChannel, type GatewayLog } from '../shared/types';
import type { GatewayContext, GatewayStore } from '../worker/env';
import { anthropicErrorResponse, handleAnthropicMessages } from '../worker/anthropic-ingress';
import { sseBytes } from '../worker/sse';

const model = 'client-alias', actualModel = 'provider-model';
const input = { model, max_tokens: 512, messages: [{ role: 'user', content: 'Hello' }] };
function setup(protocol: 'openai' | 'anthropic' | 'gemini' = 'openai') {
  const channel: GatewayChannel = { id: 'channel', name: 'Native ingress', provider: 'NewAPI', model: actualModel, models: [actualModel], tags: [], weight: 1, endpoint: 'https://upstream.example', status: 'healthy', priority: 0, ttft: 0, successRate: 100, requests: 0, enabled: true, color: '#000', history: [], createdAt: new Date().toISOString(), archived: false, credentialCount: 1,
    health: { averageTtft: null, averageDuration: null, samples: 0, cooldownUntil: null, recoveryCount: 0, failureCount: 0, reason: null, autoDisabled: false }, config: { ...structuredClone(defaultChannelConfig), protocol, integration: 'newapi', aliases: [{ from: model, to: actualModel }] } };
  const attempts: AttemptRecord[] = [], logs: GatewayLog[] = [];
  const context: GatewayContext = { channels: [channel], settings: { ...defaultSettings, errorMode: 'raw', retryEnabled: false, emptyResponseDetection: false }, env: {} as GatewayContext['env'], ctx: { waitUntil: vi.fn() } as unknown as ExecutionContext, key: null, profile: null, source: 'api' };
  const store: GatewayStore = {
    getCredentials: async () => [{ id: 'credential', label: 'upstream', secret: 'upstream-private-secret', enabled: true, failureCount: 0, disabledAt: null }],
    recordAttempt: async value => { attempts.push(value); }, recordLog: async value => { logs.push(value); }, recordEvent: async () => {},
    getRecentAttempts: async () => [], updateHealth: async () => {}, setCredentialHealth: async () => {}, incrementKeyUsage: async () => true,
    nextRoundRobin: async () => 0, getSticky: async () => null, setSticky: async () => {}, getAiGatewayToken: async () => null, reserveChannel: async () => true,
  };
  return { context, store, attempts, logs };
}
function request(signal?: AbortSignal) { return new Request('https://gateway.test/v1/messages', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': 'pg_live_input', 'x-trace-id': 'native-trace' }, body: JSON.stringify(input) }); }
function reply(protocol: 'openai' | 'anthropic' | 'gemini', tools = false) {
  if (protocol === 'anthropic') return Response.json({ id: 'msg_upstream', type: 'message', role: 'assistant', model: actualModel, content: [{ type: 'text', text: 'Hello back' }, ...(tools ? [{ type: 'tool_use', id: 'toolu_original', name: 'lookup', input: { city: '杭州' } }] : [])], stop_reason: tools ? 'tool_use' : 'stop_sequence', stop_sequence: tools ? null : 'END', usage: { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } });
  if (protocol === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: 'Hello back' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 3 } });
  return Response.json({ id: 'chatcmpl_upstream', model: actualModel, choices: [{ index: 0, message: { role: 'assistant', content: 'Hello back', ...(tools ? { tool_calls: [{ id: 'toolu_original', type: 'function', function: { name: 'lookup', arguments: '{"city":"杭州"}' } }] } : {}) }, finish_reason: tools ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 14, completion_tokens: 3, total_tokens: 17 } });
}
function streaming(chunks: unknown[]) { return new Response(chunks.map(chunk => new TextDecoder().decode(sseBytes(chunk))).join(''), { headers: { 'content-type': 'text/event-stream' } }); }
async function events(response: Response) { const text = await response.text(); return text.split('\n\n').filter(Boolean).map(frame => ({ event: /^event: (.+)$/m.exec(frame)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(frame)![1]) })); }
afterEach(() => vi.unstubAllGlobals());

describe('Anthropic native Messages ingress through the gateway', () => {
  it.each(['openai', 'anthropic', 'gemini'] as const)('routes aliases to %s upstreams and returns native message identity/usage', async protocol => {
    const { context, store, attempts, logs } = setup(protocol);
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (protocol === 'gemini') expect(String(url)).toContain(`/models/${actualModel}:generateContent`);
      else expect(payload.model).toBe(actualModel);
      expect(new Headers(init?.headers).get('x-api-key')).toBe(protocol === 'anthropic' ? 'upstream-private-secret' : null);
      return reply(protocol);
    }); vi.stubGlobal('fetch', fetcher);
    const response = await handleAnthropicMessages(request(), input, context, store), value = await response.json() as any;
    expect(response.status).toBe(200); expect(response.headers.get('request-id')).toBe(response.headers.get('x-pulsegate-request-id'));
    expect(value).toMatchObject({ type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Hello back' }], usage: { output_tokens: 3 } });
    if (protocol === 'anthropic') { expect(value.usage).toEqual({ input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 }); expect(value.stop_reason).toBe('stop_sequence'); expect(value.stop_sequence).toBe('END'); }
    else expect(value.usage.input_tokens).toBe(14);
    expect(attempts[0].model).toBe(actualModel); expect(logs[0]).toMatchObject({ model, source: 'api', traceId: 'native-trace', tokens: 17 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['openai', 'anthropic'] as const)('preserves tools, IDs, system text and image sources when forwarding to %s', async protocol => {
    const { context, store } = setup(protocol);
    const body = { ...input, system: [{ type: 'text', text: 'System one' }, { type: 'text', text: 'System two' }], temperature: 0.4, top_p: 0.9, stop_sequences: ['END'],
      tools: [{ name: 'lookup', description: 'Look up city', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }], tool_choice: { type: 'tool', name: 'lookup' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Inspect' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }, { type: 'image', source: { type: 'url', url: 'https://images.example/pic.png' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'toolu_history', name: 'lookup', input: { city: '杭州' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_history', content: [{ type: 'text', text: 'Sunny' }] }, { type: 'text', text: 'Continue' }] },
      ] };
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.max_tokens).toBe(512); expect(payload.temperature).toBe(0.4); expect(payload.top_p).toBe(0.9);
      if (protocol === 'anthropic') {
        expect(payload.system).toEqual(body.system); expect(payload.messages[0]).toEqual(body.messages[0]); expect(payload.messages[1]).toEqual(body.messages[1]);
        expect(payload.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_history', content: 'Sunny' }, { type: 'text', text: 'Continue' }] });
        expect(payload.tools).toEqual(body.tools); expect(payload.tool_choice).toEqual(body.tool_choice); expect(payload.stop_sequences).toEqual(['END']);
      } else {
        expect(payload.messages[0]).toEqual({ role: 'system', content: body.system });
        expect(payload.messages[1].content).toEqual([{ type: 'text', text: 'Inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }, { type: 'image_url', image_url: { url: 'https://images.example/pic.png' } }]);
        expect(payload.messages.find((message: any) => message.tool_calls)?.tool_calls[0]).toEqual({ id: 'toolu_history', type: 'function', function: { name: 'lookup', arguments: '{"city":"杭州"}' } });
        expect(payload.messages.find((message: any) => message.role === 'tool')).toEqual({ role: 'tool', tool_call_id: 'toolu_history', content: 'Sunny' });
        expect(payload.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } }); expect(payload.stop).toEqual(['END']);
      }
      return reply(protocol, true);
    }));
    const response = await handleAnthropicMessages(request(), body, context, store), value = await response.json() as any;
    expect(response.status).toBe(200); expect(value.stop_reason).toBe('tool_use'); expect(value.content.at(-1)).toEqual({ type: 'tool_use', id: 'toolu_original', name: 'lookup', input: { city: '杭州' } });
  });

  it('converts OpenAI streaming text and fragmented parallel tools into named native events', async () => {
    const { context, store, logs } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => streaming([
      { id: 'chat_stream', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'Hello ' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: '世界' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'toolu_one', type: 'function', function: { name: 'look', arguments: '' } }, { index: 1, id: 'toolu_two', type: 'function', function: { name: 'clock', arguments: '' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'up', arguments: '{"city":' } }, { index: 1, function: { arguments: '{' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"杭州"}' } }, { index: 1, function: { arguments: '}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }, { choices: [], usage: { prompt_tokens: 4, completion_tokens: 9 } }, '[DONE]',
    ])));
    const result = await events(await handleAnthropicMessages(request(), { ...input, stream: true }, context, store));
    expect(result.every(event => event.event === event.data.type)).toBe(true); expect(result[0].data.message.model).toBe(model);
    expect(result.filter(event => event.data.delta?.type === 'text_delta').map(event => event.data.delta.text).join('')).toBe('Hello 世界');
    const starts = result.filter(event => event.event === 'content_block_start' && event.data.content_block.type === 'tool_use');
    expect(starts.map(event => event.data.content_block)).toEqual([{ type: 'tool_use', id: 'toolu_one', name: 'lookup', input: {} }, { type: 'tool_use', id: 'toolu_two', name: 'clock', input: {} }]);
    for (const [position, expected] of [[0, { city: '杭州' }], [1, {}]] as const) { const index = starts[position].data.index; expect(JSON.parse(result.filter(event => event.data.index === index && event.data.delta?.type === 'input_json_delta').map(event => event.data.delta.partial_json).join(''))).toEqual(expected); }
    expect(result.at(-2)?.data).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 4, output_tokens: 9 } }); expect(result.at(-1)?.event).toBe('message_stop'); expect(logs[0].result).not.toBe('error');
  });

  it('groups parallel native tool history into one assistant tool_calls message for OpenAI', async () => {
    const { context, store } = setup();
    const body = { ...input, messages: [
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'call_one', name: 'lookup', input: {} }, { type: 'tool_use', id: 'call_two', name: 'clock', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_one', content: 'one' }, { type: 'tool_result', tool_use_id: 'call_two', content: 'two' }] },
    ] };
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.messages[1].tool_calls.map((call: any) => call.id)).toEqual(['call_one', 'call_two']);
      expect(payload.messages[1].content).toEqual([{ type: 'text', text: 'Checking' }]);
      expect(payload.messages.slice(2).map((message: any) => message.tool_call_id)).toEqual(['call_one', 'call_two']);
      return reply('openai');
    }));
    expect((await handleAnthropicMessages(request(), body, context, store)).status).toBe(200);
  });

  it('returns a native error for malformed streamed tool JSON instead of a successful stop', async () => {
    const { context, store, attempts, logs } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => streaming([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_one', type: 'function', function: { name: 'lookup', arguments: '{broken' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]',
    ])));
    const result = await events(await handleAnthropicMessages(request(), { ...input, stream: true }, context, store));
    expect(result.at(-1)?.event).toBe('error'); expect(result.some(event => event.event === 'message_stop')).toBe(false);
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ result: 'error', status: 502 });
    expect(logs).toHaveLength(1); expect(logs[0]).toMatchObject({ result: 'error', status: 502 });
  });

  it('rejects malformed native Message usage and never fabricates a valid native response', async () => {
    const { context, store, attempts, logs } = setup('anthropic');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'msg_invalid', type: 'message', role: 'assistant', model: actualModel, content: [{ type: 'text', text: 'Answer' }], stop_reason: 'end_turn', usage: { input_tokens: 'bad', output_tokens: 3 } })));
    const response = await handleAnthropicMessages(request(), input, context, store);
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ type: 'error', error: { type: 'api_error' } });
    expect(attempts[0]).toMatchObject({ result: 'error', status: 502 }); expect(logs[0]).toMatchObject({ result: 'error', status: 502 });
  });

  it('fails over before recording success when the preferred native JSON response is invalid', async () => {
    const { context, store, attempts, logs } = setup('anthropic');
    const preferred = context.channels[0];
    context.channels.push({ ...structuredClone(preferred), id: 'backup', name: 'Backup', endpoint: 'https://backup.example', priority: 1, config: { ...structuredClone(preferred.config), protocol: 'openai' } });
    context.settings = { ...context.settings, strategy: 'round-robin', retryEnabled: true, maxSameChannelRetries: 0, maxChannelRetries: 1, retryDelayMs: 100 };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('backup.example') ? reply('openai') : Response.json({ id: 'msg_bad', content: [{ type: 'text', text: 'Bad' }], usage: { input_tokens: 'bad', output_tokens: 1 } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await handleAnthropicMessages(request(), input, context, store);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ model, content: [{ type: 'text', text: 'Hello back' }] });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(attempts.map(attempt => attempt.result)).toEqual(['error', 'success']);
    expect(logs).toHaveLength(1); expect(logs[0]).toMatchObject({ result: 'failover', channelId: 'backup', status: 200 });
  });

  it('rejects a native content delta without an open matching block', async () => {
    const { context, store } = setup('anthropic');
    vi.stubGlobal('fetch', vi.fn(async () => streaming([
      { type: 'message_start', message: { id: 'msg_bad_block', type: 'message', role: 'assistant', model: actualModel, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_delta', index: 9, delta: { type: 'text_delta', text: 'Wrong index' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
    ])));
    const response = await handleAnthropicMessages(request(), { ...input, stream: true }, context, store);
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ type: 'error', error: { type: 'api_error' } });
  });

  it.each([
    { delta: undefined, usage: { output_tokens: 1 } },
    { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 'bad' } },
    { delta: { stop_reason: 'invalid-stop' }, usage: { output_tokens: 1 } },
    { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: -1 } },
  ])('rejects malformed native terminal events and records the stream as failed: %j', async terminal => {
    const { context, store, attempts, logs } = setup('anthropic');
    vi.stubGlobal('fetch', vi.fn(async () => streaming([
      { type: 'message_start', message: { id: 'msg_bad_terminal', type: 'message', role: 'assistant', model: actualModel, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Early token' } },
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', ...terminal }, { type: 'message_stop' },
    ])));
    const result = await events(await handleAnthropicMessages(request(), { ...input, stream: true }, context, store));
    expect(result.at(-1)?.event).toBe('error'); expect(result.some(event => event.event === 'message_stop')).toBe(false);
    expect(attempts[0]).toMatchObject({ result: 'error', status: 502 }); expect(logs[0]).toMatchObject({ result: 'error', status: 502 });
  });

  it('relays native Anthropic block order, thinking signatures and cache usage without duplicates', async () => {
    const { context, store, logs } = setup('anthropic');
    const native = [
      { type: 'message_start', message: { id: 'msg_native', type: 'message', role: 'assistant', model: actualModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Think' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } }, { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } }, { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'stop_sequence', stop_sequence: 'END' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
    ]; vi.stubGlobal('fetch', vi.fn(async () => streaming(native)));
    const result = await events(await handleAnthropicMessages(request(), { ...input, stream: true }, context, store));
    expect(result.map(event => event.data)).toEqual(native.map(event => event.type === 'message_start' ? { ...event, message: { ...event.message, model } } : event));
    expect(logs[0]).toMatchObject({ tokens: 17, result: 'success' });
  });

  it('keeps streaming incremental and cancels the upstream when the native reader is cancelled', async () => {
    const { context, store, logs } = setup(); let cancelled = false, upstreamSignal: AbortSignal | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      upstreamSignal = init?.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(sseBytes({ choices: [{ index: 0, delta: { content: 'early' }, finish_reason: null }] })); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    const response = await handleAnthropicMessages(request(), { ...input, stream: true }, context, store), reader = response.body!.getReader();
    const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain('event: message_start');
    await reader.read(); await reader.read(); await reader.cancel();
    expect(cancelled).toBe(true); expect(upstreamSignal!.aborted).toBe(true); expect(logs[0].status).toBe(499);
  });

  it('translates errors occurring after the first token and never emits a successful message_stop', async () => {
    const { context, store } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => streaming([{ choices: [{ index: 0, delta: { content: 'early' }, finish_reason: null }] }, { error: { message: 'failed upstream-private-secret' } }])));
    const result = await events(await handleAnthropicMessages(request(), { ...input, stream: true }, context, store));
    expect(result.at(-1)?.event).toBe('error'); expect(result.at(-1)?.data.error.type).toBe('api_error');
    expect(JSON.stringify(result)).not.toContain('upstream-private-secret'); expect(result.some(event => event.event === 'message_stop')).toBe(false);
  });

  it('returns native error envelopes for gateway scope and upstream errors', async () => {
    const { context, store } = setup();
    const denied = await handleAnthropicMessages(request(), { ...input, model: 'missing' }, context, store);
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ type: 'error', error: { type: 'permission_error' } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'busy' } }, { status: 429 })));
    const failed = await handleAnthropicMessages(request(), input, context, store); expect(failed.status).toBe(429); expect(await failed.json()).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } });
    expect(await anthropicErrorResponse(401, 'bad key').json()).toEqual({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
  });

  it.each([
    { max_tokens: 0 }, { max_tokens: undefined }, { stream: 'true' }, { messages: [] }, { temperature: 2 }, { top_p: -1 }, { thinking: { type: 'enabled', budget_tokens: 128 } }, { top_k: 1 }, { metadata: { user_id: 'x' } },
    { system: [{ type: 'text', text: 'cached', cache_control: { type: 'ephemeral' } }] },
    { messages: [{ role: 'system', content: 'No' }] }, { messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }] },
    { messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 'y' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'text/plain', data: 'YWJj' } }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'not_base64' } }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'javascript:alert(1)' } }] }] },
    { tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, { tool_choice: { type: 'auto', disable_parallel_tool_use: true } },
    { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] }] },
  ])('rejects invalid or unsupported native features before any upstream fetch: %s', async patch => {
    const { context, store, logs, attempts } = setup(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await handleAnthropicMessages(request(), { ...input, ...patch }, context, store);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });
    expect(fetcher).not.toHaveBeenCalled(); expect(logs).toHaveLength(0); expect(attempts).toHaveLength(0);
  });
});
