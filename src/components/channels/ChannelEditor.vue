<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { GatewayChannel, ProviderProtocol } from '../../../shared/types';
import { defaultChannelConfig } from '../../../shared/types';
import { api } from '../../api';
import { changedChannelConfig } from '../../channel-config-patch';
import { providerModelSuggestions } from '../../provider-models';
import { useConsole } from '../../composables/useConsole';
import AppDialog from '../AppDialog.vue';
const props = defineProps<{ channel?: GatewayChannel; tags: string[]; devMode?: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const { notify } = useConsole();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const baseline = clone(props.channel?.config ?? defaultChannelConfig);
const services = [{ value: 'openai', title: 'OpenAI', endpoint: 'https://api.openai.com' }, { value: 'anthropic', title: 'Anthropic', endpoint: 'https://api.anthropic.com' }, { value: 'gemini', title: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com' }];
const initialConnection = baseline.gatewayMode === 'ai-gateway' ? 'ai-gateway' : baseline.relayUrl ? 'relay' : 'direct';
const editorTab = ref('connection');
const connectionPanels = ref<string | undefined>(initialConnection !== 'direct' ? 'connection' : undefined);
const draft = ref({ name: props.channel?.name ?? '', provider: props.channel?.provider ?? 'OpenAI', protocol: baseline.protocol, endpoint: props.channel?.endpoint ?? services[0]!.endpoint, models: [...(props.channel?.models ?? [])], model: props.channel?.model ?? '', tags: [...(props.channel?.tags ?? [])], priority: props.channel?.priority ?? 0, weight: props.channel?.weight ?? 1, enabled: props.channel?.enabled ?? true, secrets: '', connection: initialConnection, relayUrl: baseline.relayUrl, slug: baseline.customProviderSlug, balance: ['newapi', 'sub2api'].includes(baseline.integration ?? ''), backend: (baseline.integration === 'sub2api' || (!['newapi', 'sub2api'].includes(baseline.integration ?? '') && props.channel?.accountIntegration === 'sub2api') ? 'sub2api' : 'newapi') as 'newapi' | 'sub2api' });
const accounts = ref({ newapi: { mode: props.channel?.accountIntegration === 'newapi' ? props.channel.accountAuthMode ?? 'password' : 'password', username: '', password: '', accessToken: '', userId: '', cookie: '' }, sub2api: { mode: props.channel?.accountIntegration === 'sub2api' ? props.channel.accountAuthMode ?? 'password' : 'password', username: '', password: '', accessToken: '', userId: '', cookie: '' } });
const account = computed(() => accounts.value[draft.value.backend]);
const simulated = computed(() => draft.value.protocol === 'mock');
const savedAccount = computed(() => props.channel?.hasAccountCredentials && (props.channel.accountIntegration ?? baseline.integration) === draft.value.backend && (props.channel.accountAuthMode ?? 'password') === account.value.mode);
const snapshot = () => JSON.stringify({ draft: draft.value, accounts: accounts.value, modelInput: modelInput.value, batchInput: batchInput.value, tagInput: tagInput.value });
const modelInput = ref(''); const batchInput = ref(''); const tagInput = ref('');
const initial = snapshot();
const dirty = computed(() => snapshot() !== initial);
const busy = ref(false); const discard = ref(false); const revealSecret = ref(false);
const discovered = ref<string[] | null>(null); const discoverySearch = ref(''); const selectedModels = ref<string[]>([]); const discovering = ref(false); const discoveryError = ref(''); const discoveryEndpoint = ref(''); const discoveryTruncated = ref(false);
let discoveryController: AbortController | null = null; let sequence = 0;
const discoveryVisible = computed(() => (discovered.value ?? []).filter(model => model.toLowerCase().includes((discoverySearch.value ?? '').toLowerCase())));
const modelDrafts = new Map<string, { draft: typeof draft.value; modelInput: string; batchInput: string }>();
function chooseProtocol(value: ProviderProtocol) {
  if (simulated.value || busy.value || value === draft.value.protocol) return;
  if (props.channel) { draft.value.protocol = value; return; }
  modelDrafts.set(draft.value.protocol, { draft: clone(draft.value), modelInput: modelInput.value, batchInput: batchInput.value });
  const service = services.find(item => item.value === value)!;
  const saved = modelDrafts.get(value);
  const provider = services.some(item => item.title === draft.value.provider) || draft.value.provider === 'Google Gemini' ? service.title : draft.value.provider;
  const common = { name: draft.value.name, provider, tags: draft.value.tags, priority: draft.value.priority, weight: draft.value.weight, enabled: draft.value.enabled, balance: draft.value.balance, backend: draft.value.backend };
  draft.value = saved ? { ...clone(saved.draft), ...common } : { ...draft.value, ...common, protocol: value, endpoint: service.endpoint, models: [], model: '', secrets: '', connection: 'direct', relayUrl: '', slug: '' };
  modelInput.value = saved?.modelInput ?? ''; batchInput.value = saved?.batchInput ?? '';
}
function connectionConfig() {
  return changedChannelConfig({ protocol: draft.value.protocol, integration: simulated.value ? baseline.integration ?? 'native' : draft.value.balance ? draft.value.backend : 'native', gatewayMode: simulated.value ? baseline.gatewayMode : draft.value.connection === 'ai-gateway' ? 'ai-gateway' : 'direct', relayUrl: simulated.value ? baseline.relayUrl : draft.value.connection === 'relay' ? draft.value.relayUrl.trim() : draft.value.connection === initialConnection ? baseline.relayUrl : '', customProviderSlug: draft.value.connection === 'ai-gateway' ? draft.value.slug.trim() : baseline.customProviderSlug }, baseline);
}
function endpointValid(value: string, label: string) {
  const parsed = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !(props.devMode && local && parsed.protocol === 'http:')) || (!props.devMode && local)) throw new Error(`${label}需使用 HTTPS，不能包含登录信息、查询参数或片段`);
  if (value.length > 2048) throw new Error(`${label}不能超过 2,048 个字符`);
}
const values = (text: string) => [...new Set(text.split(/[,，\n]+/).map(item => item.trim()).filter(Boolean))];
function addModels(models: string[]) {
  const next = [...new Set([...draft.value.models, ...models])];
  if (next.length > 1000 || next.some(model => model.length > 256)) { notify('最多 1,000 个模型，每个 ID 不超过 256 个字符', 'error'); return; }
  draft.value.models = next; if (!draft.value.model) draft.value.model = next[0] ?? ''; modelInput.value = ''; batchInput.value = '';
}
function removeModel(model: string) { draft.value.models = draft.value.models.filter(item => item !== model); if (draft.value.model === model) draft.value.model = draft.value.models[0] ?? ''; }
function addTags() { const next = [...new Set([...draft.value.tags, ...values(tagInput.value)])]; if (next.length > 100 || next.some(tag => tag.length > 256)) { notify('最多 100 个标签，每个不超过 256 个字符', 'error'); return; } draft.value.tags = next; tagInput.value = ''; }
watch(() => [draft.value.endpoint, draft.value.protocol, draft.value.connection, draft.value.relayUrl, draft.value.slug, draft.value.secrets], () => { sequence++; discoveryController?.abort(); discovering.value = false; discovered.value = null; discoveryError.value = ''; selectedModels.value = []; });
async function discover() {
  if (busy.value || discovering.value || simulated.value) return;
  try { endpointValid(draft.value.endpoint.trim(), 'Base URL'); if (draft.value.connection === 'relay') endpointValid(draft.value.relayUrl.trim(), '中继地址'); if (draft.value.connection === 'ai-gateway' && !/^[\w-]{1,128}$/.test(draft.value.slug.trim())) throw new Error('请填写有效的自定义服务商 slug'); } catch (error) { editorTab.value = 'connection'; notify(error instanceof Error ? error.message : '请检查连接配置', 'error'); return; }
  const current = ++sequence; discoveryController?.abort(); discoveryController = new AbortController(); discovering.value = true; discoveryError.value = ''; discovered.value = null;
  try {
    const result = await api<{ models: string[]; endpoint: string; truncated?: boolean }>('/api/channels/discover-models', { method: 'POST', signal: discoveryController.signal, body: JSON.stringify({ ...(props.channel ? { channelId: props.channel.id } : {}), endpoint: draft.value.endpoint.trim(), protocol: draft.value.protocol, config: connectionConfig(), ...(draft.value.secrets.trim() ? { apiKey: draft.value.secrets.trim().split(/\r?\n/)[0] } : {}) }) });
    if (current !== sequence) return;
    if (!Array.isArray(result.models) || result.models.some(model => typeof model !== 'string')) throw new Error('上游返回了无效的模型列表');
    if (result.models.length > 1000) throw new Error('上游模型超过 1,000 个，请使用批量添加');
    discovered.value = [...new Set(result.models.map(model => model.trim()).filter(Boolean))]; discoveryEndpoint.value = result.endpoint; discoveryTruncated.value = !!result.truncated; selectedModels.value = [];
  } catch (error) { if (current === sequence) discoveryError.value = error instanceof Error ? error.message : '获取模型失败'; }
  finally { if (current === sequence) discovering.value = false; }
}
function close(force = false) { if (busy.value) return; if (dirty.value && !force) { discard.value = true; return; } discoveryController?.abort(); sequence++; emit('close'); }
function unload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
window.addEventListener('beforeunload', unload);
onBeforeUnmount(() => { window.removeEventListener('beforeunload', unload); discoveryController?.abort(); sequence++; });
async function save() {
  if (busy.value) return;
  try {
    const d = draft.value;
    if (!d.name.trim() || !d.provider.trim() || d.name.length > 128 || d.provider.length > 128) { editorTab.value = 'connection'; throw new Error('渠道名称和服务商名称须为 1–128 个字符'); }
    if (modelInput.value.trim() || batchInput.value.trim() || tagInput.value.trim()) { editorTab.value = 'models'; throw new Error('还有未添加的模型或标签，请先添加或清空输入'); }
    if (!d.models.length || !d.models.includes(d.model) || d.models.length > 1000 || d.models.some(model => !model.trim() || model.length > 256)) { editorTab.value = 'models'; throw new Error('请添加有效模型并选择默认测试模型，最多 1,000 个'); }
    if (d.tags.length > 100 || d.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 256)) { editorTab.value = 'models'; throw new Error('最多 100 个标签，每个须为 1–256 个字符'); }
    try { endpointValid(d.endpoint.trim(), 'Base URL'); if (!simulated.value && d.connection === 'relay') endpointValid(d.relayUrl.trim(), '中继地址'); if (!simulated.value && d.connection === 'ai-gateway' && !/^[\w-]{1,128}$/.test(d.slug.trim())) throw new Error('slug 仅支持字母、数字、下划线与连字符'); } catch (error) { editorTab.value = 'connection'; connectionPanels.value = 'connection'; throw error; }
    if (!Number.isInteger(Number(d.priority)) || d.priority < -10000 || d.priority > 10000 || !Number.isFinite(Number(d.weight)) || d.weight < 0 || d.weight > 10000) { editorTab.value = 'models'; throw new Error('优先级须为 -10,000 至 10,000 的整数，权重为 0–10,000'); }
    const apiKeys = [...new Set(d.secrets.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (apiKeys.length > 100 || apiKeys.some(key => key.length > 16000)) { editorTab.value = 'connection'; throw new Error('最多 100 个密钥，每个不超过 16,000 个字符'); }
    let accountCredentials: Record<string, string> | undefined;
    if (d.balance && !simulated.value) {
      editorTab.value = 'account';
      const a = account.value;
      if (a.mode === 'cookie') {
        if (!savedAccount.value && !a.cookie.trim() && !a.accessToken.trim()) throw new Error('请填写 Cookie 或后台登录 Token');
        if (a.cookie.length > 16000 || /[\x00-\x1f\x7f]/.test(a.cookie)) throw new Error('Cookie 须为单行，不超过 16,000 个字符');
        const token = a.accessToken.trim().replace(/^Bearer(?:\s+|$)/i, '');
        if ((a.accessToken.trim() && !token) || token.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(token)) throw new Error('请填写有效的后台登录 Token');
        if (a.cookie.trim() || token) accountCredentials = { cookie: a.cookie.trim(), ...(token ? { accessToken: token } : {}) };
      } else if (a.mode === 'token') {
        if ((!savedAccount.value || a.userId.trim()) && !a.accessToken.trim()) throw new Error('请填写 NewAPI 后台访问令牌');
        if (a.accessToken.length > 4096 || /\s/.test(a.accessToken.trim())) throw new Error('后台令牌不超过 4,096 个字符且不能包含空格');
        if (a.userId && (!/^\d+$/.test(a.userId) || !Number.isSafeInteger(Number(a.userId)) || Number(a.userId) <= 0)) throw new Error('用户 ID 须为正整数');
        if (a.accessToken.trim()) accountCredentials = { accessToken: a.accessToken.trim(), ...(a.userId ? { userId: a.userId } : {}) };
      } else {
        if ((!savedAccount.value || a.username || a.password) && (!a.username.trim() || !a.password)) throw new Error('请填写完整的后台账号和密码');
        if (a.username.length > 256 || a.password.length > 4096) throw new Error('账号或密码过长');
        if (a.username.trim() && a.password) accountCredentials = { username: a.username.trim(), password: a.password };
      }
    }
    busy.value = true;
    await api(props.channel ? `/api/channels/${encodeURIComponent(props.channel.id)}` : '/api/channels', { method: props.channel ? 'PATCH' : 'POST', body: JSON.stringify({ name: d.name.trim(), provider: d.provider.trim(), endpoint: d.endpoint.trim(), models: [d.model, ...d.models.filter(model => model !== d.model)], model: d.model, tags: d.tags, priority: Number(d.priority), weight: Number(d.weight), enabled: d.enabled, config: connectionConfig(), ...(apiKeys.length ? { apiKeys } : {}), ...(accountCredentials ? { accountCredentials } : {}) }) });
    d.secrets = ''; accounts.value.newapi.password = ''; accounts.value.newapi.accessToken = ''; accounts.value.sub2api.password = ''; accounts.value.sub2api.cookie = ''; accounts.value.sub2api.accessToken = ''; notify(props.channel ? '渠道已保存' : '渠道已创建', 'success'); emit('saved');
  } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error'); }
  finally { busy.value = false; }
}
</script>

<template>
  <AppDialog :model-value="true" :title="channel ? '编辑渠道' : '创建渠道'" :subtitle="channel?.name" :max-width="1040" :busy="busy" @update:model-value="close()">
    <v-form :disabled="busy" :inert="busy ? true : undefined" @submit.prevent="save" class="channel-editor">
      <aside class="editor-navigation">
        <span class="editor-nav-label">渠道配置</span>
        <v-list nav density="compact" bg-color="transparent">
          <v-list-item tag="button" type="button" role="button" :tabindex="0" title="连接上游" subtitle="地址与密钥" prepend-icon="mdi-connection" :active="editorTab === 'connection'" :aria-pressed="editorTab === 'connection'" color="primary" @click="editorTab = 'connection'" />
          <v-list-item tag="button" type="button" role="button" :tabindex="0" title="模型与路由" :subtitle="`${draft.models.length} 个模型`" prepend-icon="mdi-cube-outline" :active="editorTab === 'models'" :aria-pressed="editorTab === 'models'" color="primary" @click="editorTab = 'models'" />
          <v-list-item tag="button" type="button" role="button" :tabindex="0" title="余额账户" :subtitle="draft.balance ? '已启用' : '按需配置'" prepend-icon="mdi-wallet-outline" :active="editorTab === 'account'" :aria-pressed="editorTab === 'account'" color="primary" @click="editorTab = 'account'" />
        </v-list>
        <div class="editor-nav-note"><v-icon size="16">mdi-shield-lock-outline</v-icon><span>凭据加密保存<br />原文不会回填</span></div>
      </aside>
      <div class="editor-content">
        <section v-show="editorTab === 'connection'">
          <div class="editor-section-heading"><h3>连接上游服务</h3><p>配置接口协议、服务地址与认证。</p></div>
          <v-alert v-if="simulated" type="info" variant="tonal" density="compact" class="mb-4">本地故障模拟渠道，不发送真实上游请求。</v-alert>
          <v-btn-toggle :model-value="draft.protocol" color="primary" mandatory divided class="protocol-selector mb-4" :disabled="simulated || busy" @update:model-value="chooseProtocol($event)"><v-btn v-for="service in services" :key="service.value" :value="service.value">{{ service.title }}</v-btn></v-btn-toggle>
          <div class="editor-field-grid editor-field-grid--responsive"><v-text-field v-model="draft.name" label="渠道名称 *" maxlength="128" /><v-text-field v-model="draft.provider" label="服务商名称 *" maxlength="128" /></div>
          <v-text-field v-model="draft.endpoint" label="Base URL *" maxlength="2048" class="mb-4" hint="只填域名时，模型获取与测试自动补充协议路径。" persistent-hint />
          <v-textarea v-model="draft.secrets" :label="channel ? '追加 API Key' : '上游 API Key'" rows="3" autocomplete="off" :class="{ 'secret-masked': !revealSecret }" :hint="`每行一个；已有 ${channel?.credentialCount ?? 0} 个密钥，留空保留。`" persistent-hint :append-inner-icon="revealSecret ? 'mdi-eye-off' : 'mdi-eye'" @click:append-inner="revealSecret = !revealSecret" />
          <v-expansion-panels v-model="connectionPanels" variant="accordion" class="mt-4"><v-expansion-panel value="connection" title="高级连接方式"><v-expansion-panel-text><v-select v-model="draft.connection" :items="[{ title: '直连上游', value: 'direct' }, { title: 'HTTPS API 中继', value: 'relay' }, { title: 'Cloudflare AI Gateway', value: 'ai-gateway' }]" :disabled="simulated" label="连接方式" /><v-text-field v-if="draft.connection === 'relay'" v-model="draft.relayUrl" label="中继 Base URL *" class="mt-4" /><v-text-field v-if="draft.connection === 'ai-gateway'" v-model="draft.slug" label="自定义服务商 slug *" class="mt-4" hint="Account ID、Gateway ID 与网关令牌在全局设置中配置。" persistent-hint /></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
        </section>
        <section v-show="editorTab === 'models'">
          <div class="editor-section-heading d-flex align-center"><div><h3>支持的模型</h3><p>添加上游实际支持的模型，选择默认探测模型。</p></div><v-spacer /><v-btn variant="tonal" color="primary" :loading="discovering" :disabled="busy || simulated" prepend-icon="mdi-cloud-download-outline" @click="discover">获取模型</v-btn><v-btn v-if="discovering" variant="text" @click="sequence++; discoveryController?.abort(); discovering = false">取消</v-btn></div>
          <div class="model-add-line"><v-text-field v-model="modelInput" label="模型 ID" @keydown.enter.prevent="addModels(values(modelInput))" /><v-btn variant="tonal" @click="addModels(values(modelInput))">添加模型</v-btn></div>
          <v-alert v-if="discoveryError" type="error" variant="tonal" density="compact" class="mb-4">{{ discoveryError }}</v-alert>
          <div v-if="discovered" class="discovery-panel mb-4">
            <div class="d-flex align-center mb-3"><strong class="text-body-2">发现 {{ discovered.length }} 个模型</strong><v-chip v-if="discoveryTruncated" size="small" color="warning">列表已截断</v-chip></div>
            <v-text-field v-model="discoverySearch" label="搜索发现的模型" variant="solo-filled" flat density="compact" hide-details class="mb-2" />
            <v-checkbox :model-value="discoveryVisible.filter(model => !draft.models.includes(model)).every(model => selectedModels.includes(model)) && !!discoveryVisible.length" label="选择筛选结果" hide-details @update:model-value="selectedModels = $event ? [...new Set([...selectedModels, ...discoveryVisible.filter(model => !draft.models.includes(model))])] : selectedModels.filter(model => !discoveryVisible.includes(model))" />
            <div class="discovery-list"><v-checkbox v-for="model in discoveryVisible" :key="model" v-model="selectedModels" :value="model" :label="model" :disabled="draft.models.includes(model)" hide-details density="compact" /></div>
            <div class="d-flex align-center mt-3 ga-2"><span class="text-caption text-medium-emphasis text-truncate" :title="discoveryEndpoint">{{ discoveryEndpoint }}</span><v-spacer /><v-btn color="primary" :disabled="!selectedModels.length" @click="addModels(selectedModels); selectedModels = []">添加所选 {{ selectedModels.length }}</v-btn></div>
          </div>
          <div class="model-chips mb-4"><v-chip v-for="model in draft.models" :key="model" closable size="small" variant="tonal" @click:close="removeModel(model)">{{ model }}</v-chip><div v-if="!draft.models.length" class="model-empty"><v-icon size="18">mdi-cube-outline</v-icon><span>添加模型或从上游获取列表</span></div></div>
          <v-select v-model="draft.model" :items="draft.models" label="默认测试模型 *" :disabled="!draft.models.length" class="mb-4" />
          <v-expansion-panels variant="accordion" class="mb-4"><v-expansion-panel title="批量添加与模型示例"><v-expansion-panel-text><v-textarea v-model="batchInput" label="每行一个模型，或使用逗号分隔" rows="3" /><v-btn variant="tonal" class="mt-3" @click="addModels(values(batchInput))">批量添加</v-btn><template v-if="!simulated"><p class="text-caption text-medium-emphasis mt-4 mb-3">以下示例不代表当前上游支持，请以实际模型列表为准。</p><div class="d-flex ga-2 flex-wrap"><v-chip v-for="model in providerModelSuggestions[draft.protocol as keyof typeof providerModelSuggestions]" :key="model" :disabled="draft.models.includes(model)" @click="addModels([model])">{{ model }}<v-icon end size="small">mdi-plus</v-icon></v-chip></div></template></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
          <v-divider class="mb-4" /><div class="editor-section-heading"><h3>路由与分组</h3></div>
          <div class="editor-field-grid"><v-text-field v-model.number="draft.priority" type="number" label="优先级" hint="数值越小，优先级越高" persistent-hint /><v-text-field v-model.number="draft.weight" type="number" label="权重" min="0" max="10000" /></div>
          <v-combobox v-model="draft.tags" :items="tags" multiple chips closable-chips label="标签" class="mb-4" />
          <div class="model-add-line"><v-text-field v-model="tagInput" label="新增标签，逗号分隔" /><v-btn variant="tonal" @click="addTags">添加</v-btn></div>
          <v-switch v-model="draft.enabled" :disabled="channel?.archived" label="启用渠道" color="primary" hide-details />
        </section>
        <section v-show="editorTab === 'account'">
          <div class="editor-section-heading"><h3>上游余额监控</h3><p>通过 NewAPI 或 Sub2API 账户自动刷新余额。</p></div>
          <div class="account-toggle"><div><strong class="text-body-2">自动读取账户余额</strong><p class="text-caption text-medium-emphasis mt-1">关闭监控后，已保存的凭据仍然保留。</p></div><v-switch v-model="draft.balance" :disabled="simulated" color="primary" hide-details aria-label="自动刷新账户余额" /></div>
          <template v-if="draft.balance && !simulated">
            <div class="editor-field-grid editor-field-grid--responsive mt-4"><v-select v-model="draft.backend" :items="[{ title: 'NewAPI', value: 'newapi' }, { title: 'Sub2API', value: 'sub2api' }]" label="后台类型" /><v-select v-model="account.mode" :items="[{ title: '账号密码', value: 'password' }, ...(draft.backend === 'newapi' ? [{ title: '后台访问令牌', value: 'token' }] : [{ title: 'Cookie / 登录 Token', value: 'cookie' }])]" label="认证方式" /></div>
            <v-alert v-if="savedAccount" type="info" variant="tonal" density="compact" class="mb-4">已有加密保存的账户凭据，全部留空即可沿用。</v-alert>
            <div class="account-fields"><template v-if="account.mode === 'password'"><v-text-field v-model="account.username" label="后台账号" autocomplete="off" /><v-text-field v-model="account.password" label="后台密码" type="password" autocomplete="new-password" /></template><template v-else><v-text-field v-if="account.mode === 'cookie'" v-model="account.cookie" label="Cookie" type="password" maxlength="16000" autocomplete="off" /><v-text-field v-model="account.accessToken" label="后台访问 Token" type="password" autocomplete="off" /><v-text-field v-if="account.mode === 'token'" v-model="account.userId" label="用户 ID（可选）" /></template></div>
          </template>
          <div v-else class="account-placeholder"><v-icon size="24">mdi-wallet-outline</v-icon><p>按需启用余额监控</p><span>渠道调用不依赖此账户配置。</span></div>
        </section>
      </div>
    </v-form>
    <template #actions><span class="text-caption text-medium-emphasis">{{ dirty ? '有未保存的更改' : '密钥加密保存' }}</span><v-spacer /><v-btn :disabled="busy" @click="close()">取消</v-btn><v-btn color="primary" :loading="busy" @click="save">{{ channel ? '保存更改' : '创建渠道' }}</v-btn></template>
  </AppDialog>
  <AppDialog v-model="discard" title="放弃渠道更改？" :max-width="440"><p>尚未保存的设置和密钥将丢失。</p><template #actions><v-btn @click="discard = false">继续编辑</v-btn><v-btn color="error" @click="close(true)">放弃并关闭</v-btn></template></AppDialog>
</template>
<style scoped>
.channel-editor { display: grid; grid-template-columns: 205px minmax(0, 1fr); gap: 20px; min-height: 400px; }
.editor-navigation { position: sticky; top: 0; align-self: start; padding: 12px 8px 8px; background: rgba(var(--v-theme-on-surface), .035); border-radius: 4px; }
.editor-nav-label { display: block; margin: 0 10px 8px; font-size: 12px; color: rgba(var(--v-theme-on-surface), .5); }
.editor-navigation > .v-list { padding: 4px; }
.editor-navigation :deep(.v-list-item) { width: 100%; padding-inline: 10px; margin-bottom: 4px; text-align: left; }
.editor-navigation :deep(.v-list-item__prepend > .v-icon) { font-size: 18px; }
.editor-navigation :deep(.v-list-item__prepend > .v-list-item__spacer) { width: 10px; }
.editor-navigation :deep(.v-list-item-title) { font-size: 14px; }
.editor-navigation :deep(.v-list-item-subtitle) { font-size: 12px; }
.editor-nav-note { display: flex; align-items: flex-start; gap: 8px; margin: 16px 10px 4px; color: rgba(var(--v-theme-on-surface), .5); font-size: 12px; line-height: 1.7; }
.editor-content { min-width: 0; padding-block: 3px; }
.editor-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
.editor-section-heading { gap: 10px; margin-bottom: 16px; }
.editor-section-heading h3 { font-size: 15px; font-weight: 600; }
.editor-section-heading p { margin-top: 5px; font-size: 13px; color: rgba(var(--v-theme-on-surface), .6); line-height: 1.6; }
.protocol-selector { width: 100%; background: rgba(var(--v-theme-on-surface), .04); }
.protocol-selector > .v-btn { flex: 1; }
.model-add-line { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; }
.model-add-line > .v-btn { margin-top: 4px; }
.model-chips { display: flex; gap: 7px; flex-wrap: wrap; max-height: 180px; overflow: auto; }
.model-empty { display: flex; width: 100%; align-items: center; gap: 8px; border: 1px dashed rgba(var(--v-theme-on-surface), .18); border-radius: 4px; padding: 16px 12px; color: rgba(var(--v-theme-on-surface), .5); font-size: 13px; }
.discovery-panel { border: 1px solid rgba(var(--v-theme-primary), .24); background: rgba(var(--v-theme-primary), .04); padding: 12px; border-radius: 4px; }
.discovery-list { max-height: 260px; overflow: auto; }
.secret-masked :deep(textarea) { -webkit-text-security: disc; }
.account-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; background: rgba(var(--v-theme-on-surface), .04); border-radius: 4px; }
.account-toggle > .v-switch { flex: 0 0 auto; }
.account-fields { display: grid; gap: 16px; }
.account-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 16px; color: rgba(var(--v-theme-on-surface), .38); text-align: center; }
.account-placeholder p { color: rgba(var(--v-theme-on-surface), .65); font-size: 14px; }
.account-placeholder span { font-size: 12px; }
@media (max-width: 959px) { .editor-field-grid--responsive { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 760px) { .channel-editor { grid-template-columns: minmax(0, 1fr); gap: 16px; min-height: 0; } .editor-navigation { position: static; padding: 4px; } .editor-nav-label, .editor-nav-note { display: none; } .editor-navigation > .v-list { display: flex; padding: 0; gap: 4px; } .editor-navigation :deep(.v-list-item) { flex: 1; width: auto; padding: 8px; margin: 0; min-height: 36px; } .editor-navigation :deep(.v-list-item__prepend), .editor-navigation :deep(.v-list-item-subtitle) { display: none; } .editor-navigation :deep(.v-list-item-title) { font-size: 12px; text-align: center; } .editor-section-heading { flex-wrap: wrap; } .model-add-line { flex-wrap: wrap; } .model-add-line > .v-text-field { flex-basis: 100%; } }
</style>
