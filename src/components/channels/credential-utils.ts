import type { CredentialMeta, CredentialUpdate } from '../../../shared/types';

export type CredentialDraft = { id: string; label: string; secret: string };

export function credentialStatus(key: CredentialMeta | undefined): string {
  return key?.enabled ? '可用' : key?.reason === 'BBDevLab 额度耗尽' ? '额度耗尽' : '已停用';
}

/** Empty replacement fields preserve saved secrets; send only edited fields. */
export function credentialUpdates(drafts: CredentialDraft[], baseline: CredentialMeta[]): CredentialUpdate[] {
  const saved = new Map(baseline.map(key => [key.id, key]));
  const ids = new Set<string>();
  const updates: CredentialUpdate[] = [];
  for (const draft of drafts) {
    const original = saved.get(draft.id);
    if (!original || ids.has(draft.id)) throw new Error('密钥列表已变化，请重新打开渠道编辑器');
    ids.add(draft.id);
    const label = draft.label.trim(), secret = draft.secret.trim();
    const update: CredentialUpdate = { id: draft.id };
    if (label !== original.label) {
      if (!label || label.length > 128) throw new Error('密钥名称须为 1–128 个字符');
      update.label = label;
    }
    if (secret) {
      if (secret.length > 16000) throw new Error('API Key 最多 16,000 个字符');
      update.secret = secret;
    }
    if (update.label !== undefined || update.secret !== undefined) updates.push(update);
  }
  if (updates.length > 100) throw new Error('每次最多修改 100 个密钥');
  return updates;
}
