export type SSEEvent = { event: string; data: string };
export class StreamFailure extends Error {
  constructor(message: string, public status = 502, public kind: 'error' | 'empty' = 'error') { super(message); }
}

/** Incremental SSE framing: works across split UTF-8, CRLF, multiline data and heartbeat comments. */
export async function* parseSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = 'message', data: string[] = [];
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024) throw new StreamFailure('Upstream SSE event exceeded 1 MiB');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message'; data = [];
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon);
          const raw = colon < 0 ? '' : line.slice(colon + 1); const value = raw.startsWith(' ') ? raw.slice(1) : raw;
          if (field === 'event') event = value;
          else if (field === 'data') { data.push(value); if (data.reduce((n, d) => n + d.length, 0) > 1024 * 1024) throw new StreamFailure('Upstream SSE event exceeded 1 MiB'); }
        }
      }
      if (done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
        if (data.length) yield { event, data: data.join('\n') };
        break;
      }
    }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function meaningfulOpenAIChunk(value: Record<string, any>): boolean {
  return (value.choices || []).some((choice: any) => {
    const delta = choice.delta || choice.message || {};
    return (typeof delta.content === 'string' && delta.content.length > 0) ||
      (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) ||
      (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) ||
      (typeof delta.refusal === 'string' && delta.refusal.length > 0) ||
      (Array.isArray(delta.tool_calls) && delta.tool_calls.some((t: any) => t.function?.name || t.function?.arguments || t.id)) ||
      Boolean(delta.function_call?.name || delta.function_call?.arguments);
  });
}
export function sseBytes(value: unknown): Uint8Array { return new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`); }
