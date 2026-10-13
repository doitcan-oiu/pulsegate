import { defaultChannelConfig } from './types';
import type { ProviderProtocol } from './types';

const defaultPaths = new Set(Object.values(defaultChannelConfig.endpoints));

/** Bare origins use the protocol's default version; explicit base and endpoint paths keep their meaning. */
export function resolveApiUrl(base: URL, endpointPath: string, protocol: ProviderProtocol, model = '', stream = false): URL {
  let prefix = base.pathname.replace(/\/$/, '');
  if (!prefix && protocol !== 'mock' && defaultPaths.has(endpointPath)) prefix = protocol === 'gemini' ? '/v1beta' : '/v1';
  let path = endpointPath.replace('{model}', encodeURIComponent(model));
  if (protocol === 'gemini' && stream) { path = path.replace(':generateContent', ':streamGenerateContent'); path += path.includes('?') ? '&alt=sse' : '?alt=sse'; }
  const suffix = prefix && path.startsWith(`${prefix}/`) ? path : `${prefix}/${path.replace(/^\//, '')}`;
  const target = new URL(`${base.origin}${suffix}`);
  for (const [key, value] of base.searchParams) if (!target.searchParams.has(key)) target.searchParams.set(key, value);
  return target;
}
