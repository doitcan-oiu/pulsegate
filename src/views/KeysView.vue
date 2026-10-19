<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GatewayApiKey } from '../../shared/types';
import { api } from '../api';
import { requestLimitLabel } from '../access-policy';
import { useConsole } from '../composables/useConsole';
import KeyEditor from '../components/access/KeyEditor.vue';
import ScopePreview from '../components/access/ScopePreview.vue';
import { currentProfile, keyState, scopedChannels, scopeNames, stateNames } from '../components/access/policy';

const { keys, channels, tags, notify, refresh, copy, loading } = useConsole();
const search = ref('');
const status = ref('all');
const busy = ref(false);
const editorOpen = ref(false);
const editingKey = ref<GatewayApiKey | null>(null);
const secret = ref<{ name: string; value: string } | null>(null);
const confirmation = ref<{ action: 'rotate' | 'revoke'; key: GatewayApiKey } | null>(null);
const detail = ref<GatewayApiKey | null>(null);
const detailProfileId = ref('');
const detailProfile = computed(() => detail.value?.profiles.find(profile => profile.id === detailProfileId.value) ?? (detail.value ? currentProfile(detail.value) : undefined));
watch(keys, value => { if (detail.value) detail.value = value.find(key => key.id === detail.value?.id) ?? null; });
const counts = computed(() => keys.value.reduce<Record<string, number>>((result, key) => { result[keyState(key)]++; return result; }, { all: keys.value.length, active: 0, disabled: 0, expired: 0, revoked: 0 }));
const totalRequests = computed(() => keys.value.reduce((sum, key) => sum + key.used, 0));
const visible = computed(() => keys.value.filter(key => `${key.name} ${key.note}`.toLowerCase().includes((search.value || '').trim().toLowerCase()) && (status.value === 'all' || keyState(key) === status.value)));
const headers = [{ title: '应用 / 访问凭证', key: 'name' }, { title: '状态', key: 'status' }, { title: '当前策略 / 授权范围', key: 'scope', sortable: false }, { title: '请求量 / 有效期', key: 'usage', sortable: false }, { title: '操作', key: 'actions', align: 'end' as const, sortable: false }];
const states = computed(() => [{ title: `全部状态 · ${counts.value.all}`, value: 'all' }, ...Object.entries(stateNames).map(([value, title]) => ({ title: `${title} · ${counts.value[value]}`, value }))]);
const profileItems = (key: GatewayApiKey) => key.profiles.map(profile => ({ title: profile.name, value: profile.id }));
function edit(key: GatewayApiKey | null) { editingKey.value = key; editorOpen.value = true; }
function showDetail(key: GatewayApiKey) { detail.value = key; detailProfileId.value = key.activeProfile; }
async function reload() { try { await refresh(true); } catch { notify('变更已保存，但列表刷新失败，请刷新页面', 'warning'); } }
async function run(action: () => Promise<void>) { if (busy.value) return; busy.value = true; try { await action(); } catch (error) { notify(error instanceof Error ? error.message : '操作失败', 'error'); } finally { busy.value = false; } }
async function setProfile(key: GatewayApiKey, id: string) { await run(async () => { await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'PATCH', body: JSON.stringify({ activeProfile: id }) }); notify('已切换当前生效策略', 'success'); await reload(); }); }
async function toggleStatus(key: GatewayApiKey) { await run(async () => { const next = key.status === 'active' ? 'disabled' : 'active'; await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); notify(next === 'active' ? '凭证已启用' : '凭证已停用', 'success'); await reload(); }); }
async function confirm() {
  if (!confirmation.value) return;
  const { action, key } = confirmation.value;
  await run(async () => {
    if (action === 'revoke') { await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' }); notify('API Key 已撤销', 'success'); }
    else { const result = await api<{ key: GatewayApiKey; token: string }>(`/api/keys/${encodeURIComponent(key.id)}/rotate`, { method: 'POST' }); secret.value = { name: result.key.name, value: result.token }; notify('密钥已轮换，旧密钥立即失效', 'success'); }
    confirmation.value = null; await reload();
  });
}
const expiry = (key: GatewayApiKey) => !key.expires || ['永不过期', 'never'].includes(key.expires) ? '永不过期' : `${key.expires} 到期`;
</script>

<template>
  <div class="keys-view">
    <v-card variant="flat" border class="access-table-card">
      <div class="keys-overview"><div class="keys-overview-status"><strong>应用凭证 {{ keys.length }}</strong><span class="text-success">已启用 {{ counts.active }}</span><span v-if="counts.expired" class="text-warning">已过期 {{ counts.expired }}</span><span v-if="counts.disabled" class="text-medium-emphasis">已停用 {{ counts.disabled }}</span><span v-if="counts.revoked" class="text-medium-emphasis">已撤销 {{ counts.revoked }}</span></div><span class="keys-request-total text-medium-emphasis">累计 {{ totalRequests.toLocaleString('zh-CN') }} 次请求</span><v-btn color="primary" prepend-icon="mdi-plus" :disabled="busy" class="keys-create" @click="edit(null)">创建 API Key</v-btn></div>
      <v-divider />
      <div class="keys-toolbar"><v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="搜索应用名称或备注" aria-label="搜索 API Key" density="compact" variant="solo-filled" flat hide-details clearable @click:clear="search = ''" /><v-select v-model="status" :items="states" aria-label="凭证状态" density="compact" variant="solo-filled" flat hide-details class="status-filter" /><v-btn v-if="search || status !== 'all'" variant="text" size="small" @click="search = ''; status = 'all'">重置筛选</v-btn><v-btn icon="mdi-refresh" variant="text" aria-label="刷新凭证" :loading="loading" :disabled="busy" @click="refresh()" /><span class="keys-result-count text-body-2 text-medium-emphasis">{{ visible.length }} 个结果</span></div>
      <v-divider />
      <v-data-table :headers="headers" :items="visible" :items-per-page="15" item-value="id" class="keys-table resource-table" :loading="busy" no-data-text="没有找到匹配的凭证" items-per-page-text="每页数量">
        <template #item.name="{ item }"><div class="application-cell"><v-avatar variant="tonal" size="38"><v-icon icon="mdi-application-outline" size="21" /></v-avatar><div><button class="application-name" @click="showDetail(item)">{{ item.name }}</button><code class="table-secondary d-block">{{ item.preview }}</code><div v-if="item.note" class="table-secondary key-note">{{ item.note }}</div></div></div></template>
        <template #item.status="{ item }"><v-chip :color="keyState(item) === 'active' ? 'success' : keyState(item) === 'expired' ? 'warning' : undefined" variant="tonal" size="small">{{ stateNames[keyState(item)] }}</v-chip></template>
        <template #item.scope="{ item }"><div class="py-3"><v-select v-if="item.profiles.length > 1" :model-value="item.activeProfile" :items="profileItems(item)" density="compact" hide-details :aria-label="`${item.name} 当前策略`" :disabled="busy || item.status === 'revoked'" class="key-profile-select mb-2" @update:model-value="(value: string) => setProfile(item, value)" /><div v-if="item.profiles.length === 1" class="font-weight-medium text-body-2 mb-1">{{ currentProfile(item).name }}</div><div class="text-body-2">{{ scopeNames[currentProfile(item).scope] }} · {{ scopedChannels(currentProfile(item), channels).length }} 个渠道</div><div v-if="currentProfile(item).scope === 'tags'" class="text-caption text-medium-emphasis">{{ currentProfile(item).match === 'none' ? '排除：' : '' }}{{ currentProfile(item).tags.join('、') }}</div><div class="table-secondary mt-1">{{ currentProfile(item).modelMode === 'all' ? '全部模型' : `${currentProfile(item).models.length} 个指定模型` }} · 额度 {{ requestLimitLabel(currentProfile(item).requestLimit) }}</div></div></template>
        <template #item.usage="{ item }"><div>{{ item.used.toLocaleString('zh-CN') }} 次请求</div><div :class="['text-caption', keyState(item) === 'expired' ? 'text-warning' : 'text-medium-emphasis']">{{ expiry(item) }}</div></template>
        <template #item.actions="{ item }"><div class="d-flex justify-end"><v-btn icon="mdi-pencil-outline" size="small" variant="text" :aria-label="`编辑 ${item.name}`" :disabled="busy || item.status === 'revoked'" @click="edit(item)" /><v-menu><template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-vertical" size="small" variant="text" :disabled="busy" :aria-label="`${item.name} 更多操作`" /></template><v-list density="compact"><v-list-item title="详情与权限" prepend-icon="mdi-shield-key-outline" @click="showDetail(item)" /><v-list-item :title="item.status === 'active' ? '停用凭证' : '启用凭证'" prepend-icon="mdi-power" :disabled="item.status === 'revoked'" @click="toggleStatus(item)" /><v-list-item title="轮换密钥" prepend-icon="mdi-autorenew" :disabled="item.status === 'revoked'" @click="confirmation = { action: 'rotate', key: item }" /><v-divider /><v-list-item title="撤销凭证" prepend-icon="mdi-delete-outline" base-color="error" :disabled="item.status === 'revoked'" @click="confirmation = { action: 'revoke', key: item }" /></v-list></v-menu></div></template>
        <template #no-data><div class="pa-8 text-center"><v-icon icon="mdi-key-outline" size="36" color="medium-emphasis" /><p class="mt-3 mb-4">{{ keys.length ? '没有找到匹配的凭证' : '为应用创建第一个访问凭证' }}</p><v-btn v-if="!keys.length" color="primary" @click="edit(null)">创建 API Key</v-btn><v-btn v-else variant="text" @click="search = ''; status = 'all'">重置筛选</v-btn></div></template>
      </v-data-table>
    </v-card>
    <KeyEditor v-if="editorOpen" :key-record="editingKey" :channels="channels" :tags="tags" @close="editorOpen = false" @secret="secret = $event" />
    <v-dialog :model-value="Boolean(secret)" aria-label="保存 API Key" max-width="600" persistent><v-card v-if="secret"><v-card-title class="px-6 pt-5">保存 API Key</v-card-title><v-card-text><div class="text-subtitle-2 mb-3">{{ secret.name }}</div><v-alert type="warning" variant="tonal" density="compact" class="mb-4">完整密钥仅显示一次，请复制后妥善保存。</v-alert><div class="secret-value"><code>{{ secret.value }}</code><v-btn icon="mdi-content-copy" variant="text" aria-label="复制 API Key" @click="copy(secret.value)" /></div></v-card-text><v-card-actions class="px-6 pb-4"><v-spacer /><v-btn color="primary" variant="flat" @click="secret = null">已保存，关闭</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(confirmation)" :aria-label="confirmation?.action === 'rotate' ? '轮换 API Key' : '撤销 API Key'" max-width="460" persistent><v-card v-if="confirmation" :title="confirmation.action === 'rotate' ? '轮换 API Key？' : '撤销 API Key？'"><v-card-text><p>{{ confirmation.action === 'rotate' ? `「${confirmation.key.name}」的旧密钥将立即失效，请将新密钥更新到应用中。权限和累计用量保留。` : `「${confirmation.key.name}」将立即失效，且无法重新启用。` }}</p><code class="text-medium-emphasis d-block mt-3">{{ confirmation.key.preview }}</code></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="busy" @click="confirmation = null">取消</v-btn><v-btn :color="confirmation.action === 'revoke' ? 'error' : 'primary'" variant="flat" :loading="busy" @click="confirm">{{ confirmation.action === 'rotate' ? '确认轮换' : '确认撤销' }}</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(detail)" aria-label="API Key 详情与权限" max-width="720" scrollable @update:model-value="(value: boolean) => { if (!value) detail = null; }"><v-card v-if="detail"><v-card-title class="d-flex align-center px-6 pt-5">{{ detail.name }}<v-spacer /><v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭凭证详情" @click="detail = null" /></v-card-title><v-card-text><div class="detail-grid mb-5"><div><span>访问凭证</span><code>{{ detail.preview }}</code></div><div><span>状态</span>{{ stateNames[keyState(detail)] }}</div><div><span>累计用量</span>{{ detail.used.toLocaleString('zh-CN') }} 次请求</div><div><span>有效期</span>{{ expiry(detail) }}</div><div v-if="detailProfile"><span>请求额度</span>{{ requestLimitLabel(detailProfile.requestLimit) }}</div><div><span>创建时间</span>{{ detail.createdAt }}</div></div><p v-if="detail.note" class="text-body-2 mb-4">{{ detail.note }}</p><v-alert v-if="keyState(detail) !== 'active'" type="warning" variant="tonal" density="compact" class="mb-4">此凭证{{ stateNames[keyState(detail)] }}，不能发起请求。以下显示保存的授权范围。</v-alert><v-select v-if="detail.profiles.length > 1" v-model="detailProfileId" label="查看策略" :items="detail.profiles.map(profile => ({ title: profile.name + (profile.id === detail?.activeProfile ? ' · 当前生效' : ''), value: profile.id }))" class="mb-4" hide-details /><ScopePreview v-if="detailProfile" :profile="detailProfile" :channels="channels" /></v-card-text><v-card-actions class="px-6 pb-4"><v-spacer /><v-btn @click="detail = null">关闭</v-btn><v-btn v-if="detail.status !== 'revoked'" color="primary" @click="edit(detail); detail = null">编辑权限</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.keys-view { display: grid; gap: 20px; }
.keys-overview { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 20px; padding: 16px 20px; }
.keys-overview-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-width: 0; font-size: 12px; }
.keys-overview-status strong { font-size: 14px; font-weight: 600; margin-right: 4px; }
.keys-request-total { margin-left: auto; font-size: 12px; white-space: nowrap; }
.keys-create { flex-shrink: 0; }
.keys-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 20px; background: rgba(var(--v-theme-on-surface), .025); }
.keys-toolbar > .v-input { flex: 1 1 260px; max-width: 380px; }
.keys-toolbar > .status-filter { flex: 0 1 190px; }
.keys-result-count { margin-left: auto; white-space: nowrap; }
.application-cell { display: flex; align-items: center; gap: 14px; padding: 18px 0; }
.application-name { display: block; margin-bottom: 5px; background: transparent; border: 0; padding: 0; font-size: 14px; font-weight: 600; text-align: left; color: inherit; cursor: pointer; }
.application-name:hover { color: rgb(var(--v-theme-primary)); }
.application-name:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 4px; border-radius: 2px; }
.keys-table :deep(table) { min-width: 840px; }
.key-profile-select { max-width: 240px; min-width: 180px; }
.key-note { max-width: 220px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.secret-value { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 4px; background: rgba(var(--v-theme-on-surface), .04); }
.secret-value code { min-width: 0; overflow-wrap: anywhere; flex: 1; }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; font-size: 14px; }
.detail-grid > div { min-width: 0; overflow-wrap: anywhere; }
.detail-grid span { display: block; margin-bottom: 5px; font-size: 12px; color: rgba(var(--v-theme-on-surface), .65); }
@media (max-width: 600px) { .keys-overview { padding: 14px 16px; gap: 10px 12px; } .keys-overview-status { flex: 1 1 180px; gap: 6px 12px; } .keys-request-total { order: 3; flex-basis: 100%; margin-left: 0; } .keys-create { margin-left: auto; } .keys-toolbar { padding: 16px; } .keys-toolbar > .v-input { flex-basis: 100%; max-width: none; } .keys-toolbar > .status-filter { flex-basis: 180px; } .detail-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
