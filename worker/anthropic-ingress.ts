import type { GatewayContext, GatewayStore } from './env';
import { handleGateway } from './gateway';
import type { ChatBody } from './protocols';
import { parseSSE } from './sse';
import { readUpstreamJSON } from './upstream-http';
import { HttpError } from './validation';

type Obj = Record<string, any>;
const record = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
function requireInput(condition: unknown, message: string): asserts condition { if (!condition) throw new HttpError(400, message); }
function fields(value: Obj, allowed: string[], label: string) { requireInput(Object.keys(value).every(key => allowed.includes(key)), `${label} 包含暂不支持的参数`); }
function string(value: unknown, label: string, nonempty = false): string {
  requireInput(typeof value === 'string' && (!nonempty || value.trim()), `${label} 必须为${nonempty ? '非空' : ''}文本`); return value;
}
function name(value: unknown): string { const result = string(value, '工具名称', true); requireInput(/^[A-Za-z0-9_-]{1,64}$/.test(result), '工具名称格式无效'); return result; }
function image(block: Obj): Obj {
  fields(block, ['type', 'source'], '图像内容'); requireInput(record(block.source), '图像需要有效 source');
  const source = block.source;
  if (source.type === 'base64') {
    fields(source, ['type', 'media_type', 'data'], 'Base64 图像');
    requireInput(['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(source.media_type), '图像 media_type 无效');
    const data = string(source.data, '图像 data', true);
    requireInput(data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data), '图像 data 必须为 Base64');
    return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${data}` } };
  }
  requireInput(source.type === 'url', '暂不支持此图像来源'); fields(source, ['type', 'url'], 'URL 图像');
  const url = string(source.url, '图像 URL', true); let parsed: URL;
  try { parsed = new URL(url); } catch { throw new HttpError(400, '图像 URL 无效'); }
  requireInput(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, '图像 URL 必须为 HTTP(S) 地址且不含登录凭据');
  return { type: 'image_url', image_url: { url } };
}
function textBlocks(value: unknown, label: string): Obj[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  requireInput(Array.isArray(value), `${label} 必须为文本或文本内容数组`);
  return value.map(block => {
    requireInput(record(block) && block.type === 'text', `${label} 仅支持文本`); fields(block, ['type', 'text'], label);
    return { type: 'text', text: string(block.text, label) };
  });
}

/** Supported Messages API subset; unknown controls are rejected before gateway quota/health work.
 * Contract: anthropics/anthropic-sdk-typescript src/resources/messages/messages.ts.
 */
function toChat(input: Obj): ChatBody {
  requireInput(record(input), 'Messages 请求必须为对象');
  fields(input, ['model', 'messages', 'max_tokens', 'stream', 'system', 'temperature', 'top_p', 'stop_sequences', 'tools', 'tool_choice'], 'Messages 请求');
  const model = string(input.model, 'model', true);
  requireInput(Number.isSafeInteger(input.max_tokens) && input.max_tokens > 0, 'max_tokens 必须为正整数');
  requireInput(input.stream === undefined || typeof input.stream === 'boolean', 'stream 必须为布尔值');
  requireInput(Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= 100000, 'messages 必须为非空消息数组');
  const messages: Obj[] = [], knownTools = new Set<string>(), seenTools = new Set<string>();
  if (input.system !== undefined) messages.push({ role: 'system', content: textBlocks(input.system, 'system') });
  for (const message of input.messages) {
    requireInput(record(message), '每条消息必须为对象'); fields(message, ['role', 'content'], '消息');
    requireInput(message.role === 'user' || message.role === 'assistant', 'Messages 消息角色仅支持 user / assistant');
    if (typeof message.content === 'string') { requireInput(message.content.length > 0, '消息 content 不能为空'); messages.push({ role: message.role, content: message.content }); continue; }
    requireInput(Array.isArray(message.content) && message.content.length > 0, '消息 content 必须为非空文本或内容数组');
    let parts: Obj[] = []; const calls: Obj[] = [];
    const flush = () => { if (parts.length || calls.length) { messages.push({ role: message.role, content: parts.length ? parts : null, ...(calls.length ? { tool_calls: calls } : {}) }); parts = []; } };
    let ordinary = false;
    for (const block of message.content) {
      requireInput(record(block), '内容块必须为对象');
      if (block.type === 'text') { requireInput(!calls.length, '暂不支持 tool_use 之后交错的文本内容'); fields(block, ['type', 'text'], '文本内容'); parts.push({ type: 'text', text: string(block.text, 'text') }); ordinary = true; }
      else if (block.type === 'image') { requireInput(message.role === 'user', '图像仅支持 user 消息'); parts.push(image(block)); ordinary = true; }
      else if (block.type === 'tool_use') {
        requireInput(message.role === 'assistant', 'tool_use 仅支持 assistant 消息'); fields(block, ['type', 'id', 'name', 'input'], 'tool_use');
        const id = string(block.id, 'tool_use.id', true); requireInput(!seenTools.has(id), 'tool_use.id 不得重复'); knownTools.add(id); seenTools.add(id);
        requireInput(record(block.input), 'tool_use.input 必须为 JSON 对象');
        calls.push({ id, type: 'function', function: { name: name(block.name), arguments: JSON.stringify(block.input) } });
      } else if (block.type === 'tool_result') {
        requireInput(message.role === 'user' && !ordinary, 'tool_result 须位于 user 消息普通内容之前'); fields(block, ['type', 'tool_use_id', 'content', 'is_error'], 'tool_result');
        const id = string(block.tool_use_id, 'tool_result.tool_use_id', true); requireInput(knownTools.has(id), 'tool_result 缺少对应的 tool_use');
        requireInput(block.is_error === undefined || block.is_error === false, '暂不支持 tool_result.is_error=true');
        const content = block.content === undefined ? '' : textBlocks(block.content, 'tool_result.content').map(part => part.text).join('');
        flush(); messages.push({ role: 'tool', tool_call_id: id, content }); knownTools.delete(id);
      } else throw new HttpError(400, '暂不支持此 Messages 内容类型（含思考历史、文档及服务端工具）');
    }
    flush();
  }
  const body: ChatBody = { model, messages, max_tokens: input.max_tokens, stream: input.stream ?? false };
  for (const field of ['temperature', 'top_p']) if (input[field] !== undefined) {
    requireInput(typeof input[field] === 'number' && Number.isFinite(input[field]) && input[field] >= 0 && input[field] <= 1, `${field} 必须在 0–1 范围内`); body[field] = input[field];
  }
  if (input.stop_sequences !== undefined) { requireInput(Array.isArray(input.stop_sequences) && input.stop_sequences.every((value: unknown) => typeof value === 'string'), 'stop_sequences 必须为文本数组'); body.stop = input.stop_sequences; }
  if (input.tools !== undefined) {
    requireInput(Array.isArray(input.tools), 'tools 必须为工具数组'); const names = new Set<string>();
    body.tools = input.tools.map((tool: unknown) => {
      requireInput(record(tool), '工具定义必须为对象'); fields(tool, ['name', 'description', 'input_schema', 'type'], '工具定义');
      requireInput(tool.type === undefined || tool.type === 'custom', '暂不支持服务端工具');
      const toolName = name(tool.name); requireInput(!names.has(toolName), '工具名称不得重复'); names.add(toolName);
      requireInput(record(tool.input_schema) && tool.input_schema.type === 'object', '工具 input_schema 必须为 object schema');
      return { type: 'function', function: { name: toolName, ...(tool.description !== undefined ? { description: string(tool.description, '工具 description') } : {}), parameters: tool.input_schema } };
    });
  }
  if (input.tool_choice !== undefined) {
    const choice = input.tool_choice; requireInput(record(choice), 'tool_choice 必须为对象'); fields(choice, ['type', 'name', 'disable_parallel_tool_use'], 'tool_choice');
    requireInput(choice.disable_parallel_tool_use === undefined || choice.disable_parallel_tool_use === false, '暂不支持 disable_parallel_tool_use=true');
    requireInput(['auto', 'any', 'none', 'tool'].includes(choice.type), 'tool_choice.type 无效');
    requireInput(choice.type === 'tool' || choice.name === undefined, '只有指定工具时才可填写 tool_choice.name');
    if (choice.type === 'tool') { const toolName = name(choice.name); requireInput(body.tools?.some((tool: Obj) => tool.function.name === toolName), 'tool_choice 指定的工具不存在'); body.tool_choice = { type: 'function', function: { name: toolName } }; }
    else { requireInput(!['any'].includes(choice.type) || body.tools?.length, 'tool_choice=any 需要工具'); body.tool_choice = choice.type === 'any' ? 'required' : choice.type; }
  }
  if (body.stream) body.stream_options = { include_usage: true };
  return body;
}

function errorType(status: number): string { return status === 400 ? 'invalid_request_error' : status === 401 ? 'authentication_error' : status === 403 ? 'permission_error' : status === 404 ? 'not_found_error' : status === 413 ? 'request_too_large' : status === 429 ? 'rate_limit_error' : status === 529 || status === 503 ? 'overloaded_error' : 'api_error'; }
export function anthropicErrorResponse(status: number, message: string): Response {
  return Response.json({ type: 'error', error: { type: errorType(status), message } }, { status, headers: { 'cache-control': 'no-store' } });
}
function tokens(value: unknown): number { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0; }
function validUsage(value: unknown): value is Obj { return record(value) && Number.isSafeInteger(value.input_tokens) && value.input_tokens >= 0 && Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0; }
const stopReasons = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded'];
function validStop(value: unknown): boolean { return value === null || typeof value === 'string' && stopReasons.includes(value); }
function nativeUsage(value: Obj, metadata?: Obj): Obj {
  const result: Obj = { input_tokens: tokens(value.prompt_tokens), output_tokens: tokens(value.completion_tokens) };
  if (record(metadata?.usage)) return { ...metadata.usage, input_tokens: tokens(metadata.usage.input_tokens), output_tokens: tokens(metadata.usage.output_tokens) };
  return result;
}
function stop(reason: unknown, metadata?: Obj): string | null {
  if (typeof metadata?.stop_reason === 'string') return metadata.stop_reason;
  return reason === 'tool_calls' || reason === 'function_call' ? 'tool_use' : reason === 'length' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : reason ? 'end_turn' : null;
}
function toolInput(value: unknown): Obj {
  if (typeof value !== 'string') throw new HttpError(502, '上游工具参数格式无效');
  try { const parsed = JSON.parse(value || '{}'); if (!record(parsed)) throw new Error(); return parsed; }
  catch { throw new HttpError(502, '上游工具参数不是有效 JSON 对象'); }
}
function messageJSON(value: Obj, model: string): Obj {
  const choice = value.choices?.[0]; if (!record(choice?.message) || value.choices.length !== 1) throw new HttpError(502, '上游未返回有效的单条消息');
  const message = choice.message, content: Obj[] = [], metadata = value.extra_content?.anthropic ?? message.extra_content?.anthropic;
  if (record(metadata?.message)) {
    const native = metadata.message;
    if (typeof native.id !== 'string' || !native.id || native.type !== 'message' || native.role !== 'assistant' || !validUsage(native.usage) || !validStop(native.stop_reason) || native.stop_sequence !== null && typeof native.stop_sequence !== 'string' || !Array.isArray(native.content) || native.content.some((block: unknown) => !record(block) || !['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(block.type))) throw new HttpError(502, '上游 Anthropic 消息格式无效');
    for (const block of native.content) {
      if (block.type === 'text' && typeof block.text !== 'string' || block.type === 'thinking' && (typeof block.thinking !== 'string' || typeof block.signature !== 'string') || block.type === 'redacted_thinking' && typeof block.data !== 'string' || block.type === 'tool_use' && (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name || !record(block.input))) throw new HttpError(502, '上游 Anthropic 内容块格式无效');
    }
    return { ...native, model };
  }
  if (Array.isArray(message.extra_content?.anthropic?.thinking)) content.push(...message.extra_content.anthropic.thinking);
  else if (typeof message.reasoning_content === 'string' && message.reasoning_content) content.push({ type: 'thinking', thinking: message.reasoning_content, signature: '' });
  if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  else if (message.content !== null && message.content !== undefined && message.content !== '') throw new HttpError(502, '上游返回了暂不支持的消息内容');
  if (typeof message.refusal === 'string' && message.refusal) content.push({ type: 'text', text: message.refusal });
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) throw new HttpError(502, '上游工具调用格式无效');
    for (const tool of message.tool_calls) {
      if (!record(tool) || tool.type !== 'function' || typeof tool.id !== 'string' || !tool.id || typeof tool.function?.name !== 'string' || !tool.function.name) throw new HttpError(502, '上游工具调用格式无效');
      content.push({ type: 'tool_use', id: tool.id, name: tool.function.name, input: toolInput(tool.function.arguments) });
    }
  }
  return { id: value.id || `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model, content, stop_reason: stop(choice.finish_reason, metadata), stop_sequence: metadata?.stop_sequence ?? null, usage: nativeUsage(value.usage ?? {}, metadata) };
}

const encoder = new TextEncoder();
function eventBytes(type: string, value: Obj): Uint8Array { return encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ ...value, type })}\n\n`); }
type ToolState = { index?: number; id: string; name: string; arguments: string };
function streamTranslator(model: string, emit: (type: string, value?: Obj) => void): { chunk(value: Obj): void; end(): void } {
  const tools = new Map<number, ToolState>(); let nextIndex = 0, textIndex: number | undefined, thinkingIndex: number | undefined;
  const nativeBlocks = new Map<number, { type: string; arguments: string; stopped: boolean }>();
  let begun = false, ended = false, finishReason: unknown = null, latestUsage: Obj = {}, metadata: Obj | undefined, rawNative = false, nativeStopped = false, nativeDeltaSeen = false;
  const closeText = () => { if (textIndex !== undefined) { emit('content_block_stop', { index: textIndex }); textIndex = undefined; } };
  const closeThinking = () => { if (thinkingIndex !== undefined) { const blocks = metadata?.thinking; const signature = Array.isArray(blocks) && blocks.length === 1 ? blocks[0].signature : ''; if (typeof signature === 'string') emit('content_block_delta', { index: thinkingIndex, delta: { type: 'signature_delta', signature } }); emit('content_block_stop', { index: thinkingIndex }); thinkingIndex = undefined; } };
  const startTool = (tool: ToolState) => {
    if (tool.index !== undefined) return;
    if (!tool.id || !tool.name) throw new HttpError(502, '上游流式工具调用缺少 ID 或名称');
    closeText(); closeThinking(); tool.index = nextIndex++;
    emit('content_block_start', { index: tool.index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
  };
  const finish = () => {
    if (ended) return;
    if (rawNative) { if (!nativeStopped) throw new HttpError(502, '上游 Anthropic 流缺少 message_stop'); emit('message_stop'); ended = true; return; }
    closeText(); closeThinking();
    for (const tool of tools.values()) { toolInput(tool.arguments); startTool(tool); if (!tool.arguments) emit('content_block_delta', { index: tool.index, delta: { type: 'input_json_delta', partial_json: '{}' } }); emit('content_block_stop', { index: tool.index }); }
    emit('message_delta', { delta: { stop_reason: stop(finishReason, metadata) ?? (tools.size ? 'tool_use' : 'end_turn'), stop_sequence: metadata?.stop_sequence ?? null }, usage: nativeUsage(latestUsage, metadata) }); emit('message_stop'); ended = true;
  };
  const process = (value: Obj) => {
    if (value.error) throw new HttpError(502, typeof value.error.message === 'string' ? value.error.message : '上游流式响应失败');
    const rawEvent = value.extra_content?.anthropic?.event;
    if (record(rawEvent)) {
      rawNative = true; const event = structuredClone(rawEvent);
      if (!['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop', 'ping'].includes(event.type)) throw new HttpError(502, '上游 Anthropic 事件类型无效');
      if (event.type === 'message_start') { if (begun || !record(event.message) || typeof event.message.id !== 'string' || !event.message.id || event.message.type !== 'message' || event.message.role !== 'assistant' || !validUsage(event.message.usage) || !Array.isArray(event.message.content) || event.message.content.length) throw new HttpError(502, '上游 Anthropic message_start 格式无效'); event.message.model = model; begun = true; }
      else if (!begun && event.type !== 'ping') throw new HttpError(502, '上游 Anthropic 流缺少 message_start');
      if (nativeStopped && event.type !== 'ping') throw new HttpError(502, '上游 Anthropic 流已结束');
      if (nativeDeltaSeen && event.type.startsWith('content_block_')) throw new HttpError(502, '上游 Anthropic 内容块出现在 message_delta 之后');
      if (event.type.startsWith('content_block_') && (!Number.isSafeInteger(event.index) || event.index < 0)) throw new HttpError(502, '上游 Anthropic 内容索引无效');
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (!record(block) || !['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(block.type) || nativeBlocks.has(event.index)) throw new HttpError(502, '上游 Anthropic 内容类型或索引无效');
        if (block.type === 'text' && typeof block.text !== 'string' || block.type === 'thinking' && (typeof block.thinking !== 'string' || typeof block.signature !== 'string') || block.type === 'redacted_thinking' && typeof block.data !== 'string' || block.type === 'tool_use' && (typeof block.id !== 'string' || !block.id || typeof block.name !== 'string' || !block.name || !record(block.input))) throw new HttpError(502, '上游 Anthropic 内容块格式无效');
        nativeBlocks.set(event.index, { type: block.type, arguments: block.type === 'tool_use' && Object.keys(block.input).length ? JSON.stringify(block.input) : '', stopped: false });
      }
      if (event.type === 'content_block_delta') {
        const block = nativeBlocks.get(event.index), delta = event.delta;
        if (!block || block.stopped || !record(delta) || !['text_delta', 'thinking_delta', 'signature_delta', 'input_json_delta'].includes(delta.type)) throw new HttpError(502, '上游 Anthropic 内容 delta 无效');
        const property = delta.type === 'text_delta' ? 'text' : delta.type === 'thinking_delta' ? 'thinking' : delta.type === 'signature_delta' ? 'signature' : 'partial_json';
        const expected = delta.type === 'text_delta' ? 'text' : delta.type === 'input_json_delta' ? 'tool_use' : 'thinking';
        if (block.type !== expected || typeof delta[property] !== 'string') throw new HttpError(502, '上游 Anthropic 内容 delta 与内容块不匹配');
        if (expected === 'tool_use') { block.arguments += delta.partial_json; if (block.arguments.length > 1024 * 1024) throw new HttpError(502, '上游流式工具参数超过 1 MiB'); }
      }
      if (event.type === 'content_block_stop') { const block = nativeBlocks.get(event.index); if (!block || block.stopped) throw new HttpError(502, '上游 Anthropic 内容块结束索引无效'); if (block.type === 'tool_use') toolInput(block.arguments); block.stopped = true; }
      if (event.type === 'message_delta') {
        if (!record(event.delta) || !record(event.usage) || !Number.isSafeInteger(event.usage.output_tokens) || event.usage.output_tokens < 0 || [...nativeBlocks.values()].some(block => !block.stopped)) throw new HttpError(502, '上游 Anthropic message_delta 格式或顺序无效');
        if (event.delta.stop_reason !== undefined && !validStop(event.delta.stop_reason) || event.delta.stop_sequence !== undefined && event.delta.stop_sequence !== null && typeof event.delta.stop_sequence !== 'string') throw new HttpError(502, '上游 Anthropic 停止信息格式无效');
        for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) if (event.usage[key] !== undefined && event.usage[key] !== null && (!Number.isSafeInteger(event.usage[key]) || event.usage[key] < 0)) throw new HttpError(502, '上游 Anthropic message_delta 用量无效');
        nativeDeltaSeen = true;
      }
      if (event.type === 'message_stop') { if (!nativeDeltaSeen || [...nativeBlocks.values()].some(block => !block.stopped)) throw new HttpError(502, '上游 Anthropic message_stop 顺序无效'); nativeStopped = true; return; }
      emit(event.type, event); return;
    }
    if (rawNative) return;
    if (record(value.usage)) latestUsage = value.usage;
    if (record(value.extra_content?.anthropic)) metadata = { ...metadata, ...value.extra_content.anthropic };
    if (!begun) { emit('message_start', { message: { id: value.id || `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: nativeUsage(latestUsage, metadata) } }); begun = true; }
    if (!Array.isArray(value.choices)) { if (!value.usage) throw new HttpError(502, '上游流式响应格式无效'); return; }
    if (value.choices.length > 1) throw new HttpError(502, '上游流式响应包含多个候选');
    const choice = value.choices[0]; if (!choice) return;
    const delta = choice.delta ?? {};
    if (record(delta.extra_content?.anthropic)) metadata = { ...metadata, ...delta.extra_content.anthropic };
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning) { closeText(); if (thinkingIndex === undefined) { thinkingIndex = nextIndex++; emit('content_block_start', { index: thinkingIndex, content_block: { type: 'thinking', thinking: '', signature: '' } }); } emit('content_block_delta', { index: thinkingIndex, delta: { type: 'thinking_delta', thinking: reasoning } }); }
    const text = delta.content ?? delta.refusal;
    if (text !== undefined && text !== null && typeof text !== 'string') throw new HttpError(502, '上游流式文本格式无效');
    if (text) { closeThinking(); if (textIndex === undefined) { textIndex = nextIndex++; emit('content_block_start', { index: textIndex, content_block: { type: 'text', text: '' } }); } emit('content_block_delta', { index: textIndex, delta: { type: 'text_delta', text } }); }
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) throw new HttpError(502, '上游流式工具格式无效');
      for (const fragment of delta.tool_calls) {
        if (!Number.isSafeInteger(fragment.index) || fragment.index < 0 || fragment.type && fragment.type !== 'function') throw new HttpError(502, '上游流式工具格式无效');
        const tool = tools.get(fragment.index) ?? { id: '', name: '', arguments: '' }; tools.set(fragment.index, tool);
        if (fragment.id !== undefined) { if (typeof fragment.id !== 'string' || tool.index !== undefined && fragment.id !== tool.id) throw new HttpError(502, '上游流式工具 ID 无效'); tool.id = fragment.id; }
        if (fragment.function?.name !== undefined) { if (typeof fragment.function.name !== 'string' || tool.index !== undefined) throw new HttpError(502, '上游流式工具名称无效'); tool.name += fragment.function.name; }
        const partial = fragment.function?.arguments;
        if (partial !== undefined) { if (typeof partial !== 'string') throw new HttpError(502, '上游流式工具参数无效'); tool.arguments += partial; if (tool.arguments.length > 1024 * 1024) throw new HttpError(502, '上游流式工具参数超过 1 MiB'); if (partial) { startTool(tool); emit('content_block_delta', { index: tool.index, delta: { type: 'input_json_delta', partial_json: partial } }); } }
      }
    }
  };
  return { chunk: process, end: finish };
}

function nativeStream(response: Response, model: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const cleanup = () => signal.removeEventListener('abort', abort);
  const iterator = parseSSE(response.body!, controller.signal)[Symbol.asyncIterator](), queue: Uint8Array[] = [];
  let ended = false, cancelled = false;
  const translator = streamTranslator(model, (type, value = {}) => queue.push(eventBytes(type, value)));
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        while (!queue.length && !ended) {
          const item = await iterator.next(); if (cancelled) return;
          if (item.done) throw new HttpError(502, '上游流式响应缺少结束标记');
          if (item.value.data === '[DONE]') { translator.end(); ended = true; }
          else { let value: Obj; try { value = JSON.parse(item.value.data); } catch { throw new HttpError(502, '上游流式 JSON 无效'); } if (!record(value)) throw new HttpError(502, '上游流式 JSON 无效'); translator.chunk(value); }
        }
        if (queue.length) output.enqueue(queue.shift()!);
        if (ended && !queue.length) { cleanup(); output.close(); await iterator.return?.(undefined); }
      } catch (error) {
        ended = true; queue.length = 0; controller.abort(); cleanup(); await iterator.return?.(undefined).catch(() => {});
        if (!cancelled) { if (!signal.aborted) output.enqueue(eventBytes('error', { error: { type: 'api_error', message: error instanceof HttpError ? error.message : '上游流式响应失败' } })); output.close(); }
      }
    },
    async cancel() { cancelled = true; ended = true; queue.length = 0; controller.abort(); cleanup(); await iterator.return?.(undefined).catch(() => {}); },
  });
}

export async function handleAnthropicMessages(request: Request, input: Record<string, unknown>, context: GatewayContext, store: GatewayStore): Promise<Response> {
  try {
    const chat = toChat(input);
    const headers = new Headers(request.headers); headers.delete('content-length'); headers.set('content-type', 'application/json');
    const responseValidator: NonNullable<GatewayContext['responseValidator']> = { json: value => { messageJSON(value, chat.model); }, stream: () => streamTranslator(chat.model, () => {}) };
    const result = await handleGateway(new Request(new URL('/v1/chat/completions', request.url), { method: 'POST', headers, signal: request.signal, body: JSON.stringify(chat) }), { ...context, responseProtocol: 'anthropic', responseValidator }, store);
    const outputHeaders = new Headers(result.headers); outputHeaders.delete('content-length');
    const requestId = result.headers.get('x-pulsegate-request-id'); if (requestId) outputHeaders.set('request-id', requestId);
    if (!result.ok) { const value = await readUpstreamJSON(result, 8 * 1024 * 1024); const failure = anthropicErrorResponse(result.status, typeof value.error?.message === 'string' ? value.error.message : '网关请求失败'); outputHeaders.set('cache-control', 'no-store'); outputHeaders.set('content-type', 'application/json'); return new Response(failure.body, { status: failure.status, headers: outputHeaders }); }
    if (chat.stream) { if (!result.body) throw new HttpError(502, '上游流式响应为空'); outputHeaders.set('content-type', 'text/event-stream; charset=utf-8'); return new Response(nativeStream(result, chat.model, request.signal), { headers: outputHeaders }); }
    outputHeaders.set('content-type', 'application/json');
    return Response.json(messageJSON(await readUpstreamJSON(result, 8 * 1024 * 1024), chat.model), { headers: outputHeaders });
  } catch (error) { return anthropicErrorResponse(error instanceof HttpError ? error.status : 500, error instanceof HttpError ? error.message : 'Gateway operation failed; check server configuration'); }
}
