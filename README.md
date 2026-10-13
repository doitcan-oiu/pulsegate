# PulseGate · 智能大模型网关

基于 **Cloudflare Workers + D1 + Durable Objects + React** 的大模型网关。结合 HTTP 状态、SSE 首字延迟（TTFT）、非流式完整响应耗时、空响应及流中断判断上游质量，在 API Key 授权范围内重试和切换渠道。

已接入真实后端、D1 持久化、Chat Completions 与 Anthropic Messages 原样转发入口、Cloudflare AI Gateway 自定义服务商和交互式测试场。新安装的数据为空；本地测试渠道需要主动创建，生产不会安装演示数据。前端统一使用 HeroUI 3 的组件及默认配色；[DESIGN.md](DESIGN.md) 保留为早期设计参考。

## 功能

| 模块 | 当前实现 |
| --- | --- |
| 添加渠道 | OpenAI / Anthropic / Gemini 接口类型，用于模型获取和渠道测试；独立的 NewAPI / Sub2API 余额监控选项、多密钥；支持模型搜索、多选、手动/批量添加及默认测试模型 |
| 后台余额 | NewAPI 账号密码/后台令牌、Sub2API 账号密码/浏览器会话，凭据与登录会话 AES-GCM 加密；每 5 分钟刷新，名称副标题展示余额与状态，可点击立即刷新 |
| 渠道列表 | 搜索、服务商/状态/标签/模型筛选、分页、列设置、批量启停/标签/权重、JSON 导入 |
| 渠道菜单 | HeroUI 可视化弹窗：模型映射行、价格与成本预览、类型化请求覆盖、连接与端点预览、限额卡片、状态码选择与恢复流程、密钥轮换、SSE/非流式测试及历史；支持复制、归档与删除 |
| API Keys | 精简凭证列表与固定操作栏；基础名称和渠道权限优先，高级模型/映射/额度/多 Profile 默认折叠，保留启停/撤销/轮换、到期与标签授权 |
| 调度策略 | 故障转移、自适应延迟、轮询、权重随机、熔断、trace/thread 会话粘性 |
| 重试 | 总开关、跨渠道/单渠道次数、间隔、状态码、首字/响应超时、空响应、原始/通用/自定义错误 |
| 健康判定 | 流式首字连续 N 次慢才降级；非流式平均耗时、独立窗口、失败比例、冷却及连续恢复 |
| 测试场 | 单渠道直测/网关 Key Profile、模型、SSE/JSON、温度、最大输出、系统提示、聊天、停止、重试、清空、指标/请求轨迹 |
| 观测 | 紧凑日志表格、尝试追踪、脱敏上游错误、筛选/导出；确认后可清空全部日志及尝试详情；切换/恢复事件、请求/Token/费用统计 |
| 用量分析 | 核心指标、P50/P95 首字与完成耗时、重试/切换率、吞吐、生成速度；8 个双列图表，小屏单列，按所选范围统计且排除健康探测 |
| 网关设置 | 接入与运行 / 调度与健康 Tabs；基础设置优先，高级重试、健康窗口和禁用恢复分组配置 |

前端使用 React、TypeScript 和 HeroUI 3，通知使用 HeroUI Toast；Recharts 与 Lucide 分别用于图表和操作图标。页面使用统一的系统中英文字体、文字层级和控件间距，颜色来自 HeroUI 默认主题。OpenAI、Anthropic、Gemini 的品牌 SVG 来源于 [Simple Icons](https://github.com/simple-icons/simple-icons)，对应品牌归各自所有者。

获取模型由 Worker 请求上游，使用当前草稿的 Base URL、连接方式和密钥；编辑已有渠道可复用已保存密钥。默认 OpenAI 兼容地址为 `/v1/models`，Anthropic 和 Gemini 使用原生列表格式及分页，最多加载 1,000 个模型并提示截断。获取不会自动创建渠道或替用户开放全部模型。

渠道和中继的 Base URL 可以只填域名（如 `https://api.anthropic.com`）。模型获取与渠道测试按所选接口类型使用默认端点：OpenAI / Anthropic 自动补 `/v1`，Gemini 自动补 `/v1beta`；公开调用沿用客户端入口对应的路径。已经填写的版本或部署子目录保持原样；自定义端点路径也按原配置拼接，不自动添加版本。

NewAPI / Sub2API 的后台凭据独立于推理 API Key。后台地址从 Base URL 去除末尾 `/v1` 或 `/v1beta` 推导，保留部署子目录；余额不经过 AI Gateway。NewAPI 使用 `/api/user/self` 的 `quota`，按站点 `/api/status` 的 `quota_per_unit` 换算为 USD，无法取得比例时显示原始额度；Sub2API 显示后台 `balance`。支持 NewAPI 旧 Cookie、新 Token 与可选 RSA 密码加密登录，以及 Sub2API Token 登录。NewAPI 还可选择后台访问令牌，在个人设置中生成并填写；旧版站点同时需要数字用户 ID，新版 PAT 可省略。令牌使用 `Authorization: Bearer`，旧版用户标识使用 `New-Api-User`，均加密保存、不回显。[NewAPI 官方后台鉴权说明](https://docs.newapi.pro/zh/docs/api/management/auth)。

NewAPI 开启 Turnstile 人机验证时，账号密码登录会提示改用后台访问令牌。二次验证、禁用密码登录、令牌失效和用户 ID 错误也会给出具体提示，失败时保留上次成功余额及时间。自动刷新采用 D1 租约、版本校验和有限批次，账户较多时分批处理；归档渠道不刷新。Cloudflare Cron 在页面关闭后继续运行，本地打开控制台时也会触发到期刷新。

Sub2API 可选择「Cookie / 浏览器会话」读取余额，不再由网关提交邮箱密码登录。先在浏览器登录后台并完成人机验证，再从开发者工具「网络」中的个人信息或余额请求复制单行 `Cookie` 请求头值。标准 Sub2API 通过 Bearer JWT 识别登录用户，可只填同一请求的 `Authorization` 值或本地存储中的 `auth_token`，支持 `Bearer` 前缀；只有 `cf_clearance` 等人机验证 Cookie 不足以读取余额。需要 Cookie 的站点同时填写，使用 Cookie 认证的定制站点可只填 Cookie。Cookie 与后台登录 Token 至少填写一个，均加密保存、不回显；编辑时全部留空保留现有会话，填写新会话会替换已保存 Cookie 和 Token，请提供所需的完整会话。浏览器会话过期或失效后需手动重新登录并更新。

模型别名采用可搜索的紧凑列表编辑；请求转发使用上游模型名称，JSON 响应及每个 SSE JSON 事件的 `model` 返回客户端原始请求的公开模型名，跨渠道切换后也保持一致。

上游接口类型与余额后台分别配置：OpenAI / Anthropic / Gemini 接口类型用于模型发现与渠道测试，不决定公开请求的格式。可独立打开「上游余额监控」并选择 NewAPI / Sub2API，监控只决定后台余额的认证和读取方式。已有渠道按原接口类型和监控类型加载，可直接切换真实渠道的接口类型；关闭监控保留已保存凭据、会话和最近余额，恢复同一后台可继续使用。切换后台类型须提供对应凭据，账户草稿按后台类型独立保留。历史数据无需数据库迁移。

已有安装升级时需应用新的账户表迁移，账号和会话均不保存在渠道公开 JSON 中：

```bash
npx wrangler d1 migrations apply DB --local --config wrangler.dev.jsonc --persist-to .wrangler/state
```

## 本地启动

需要 Node.js 22 或更新的兼容版本及 npm。首次运行：

```bash
npm install
npm run setup:local
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。Vite 将 `/api`、`/v1` 转发给 `127.0.0.1:8787` 的真实 Workers 运行时。本地页面会自动建立开发登录会话，无需手动输入令牌；该开发入口同时要求 `DEV_MODE=true` 和请求地址是 loopback。生产页面需使用管理员令牌登录。

`setup:local` 生成 `.dev.vars` 中的随机管理员令牌、32 字节 AES 密钥并应用 D1 migrations，已有密钥不会覆盖。本地数据库/路由状态位于 `.wrangler/state`，重启后保留；这些文件已加入 Git 忽略。

在页面主动安装两个本地 Mock 渠道后，可测试健康、延迟、HTTP 错误、空响应、断流、暂时失败。Mock 经过真实鉴权、调度、SSE 和 D1 日志流程；清理 fixtures 不会删除其他渠道。

```bash
npm test
npm run build
```

测试使用 Cloudflare 官方 Vitest 插件，在 Workers 运行时验证 D1/DO、加密、鉴权、并发额度/限流、协议、SSE、重试、健康判定。Vitest 使用兼容的 4.1 系列，避免 5.0 在 Windows 的文件 URL 问题。`npm run preview` 仅预览前端构建，完整接口请使用 `npm run dev`。

## Cloudflare 部署

`wrangler.jsonc` 包含 Worker、静态资源、D1、短状态操作串行协调的 Durable Object 和每分钟恢复探测/清理 Cron。生产 `DEV_MODE=false`，上游请求/SSE 网络读取不在 Durable Object 中排队。

```bash
npx wrangler login
npm run deploy
```

`deploy` 构建、发布 Worker 并应用远端 migrations。Wrangler 可为没有 `database_id` 的 D1 绑定创建资源；已有数据库可在 `d1_databases` 中填写自己的 `database_id`。Worker/数据库名可在配置修改。[Cloudflare D1 绑定说明](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)

首次部署后设置两个必需的生产 Secret，按命令提示输入值：

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ENCRYPTION_KEY
```

`ADMIN_TOKEN` 使用强随机字符串；`ENCRYPTION_KEY` 必须是 **base64 编码的 32 字节 AES 密钥**，可在本机生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

生产没有默认口令/默认加密密钥。打开 Worker 地址，用管理员令牌登录；登录采用 HttpOnly、SameSite=Strict Cookie，写入校验 Origin。不要把 Secret 加入 `VITE_*`、仓库或明文 Header。保管好加密密钥：直接替换会让已存上游密钥/Gateway Token 无法解密；当前没有重加密迁移工具。

### 一键自动部署

<!-- deploy-button:start -->
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO)

> 按当前要求暂不绑定仓库。`OWNER/REPO` 是占位，按钮尚不能完成自动部署；确定真实公开仓库后更新。
<!-- deploy-button:end -->

绑定实际 `git remote origin` 后执行，或显式传入公开仓库：

```bash
npm run deploy:button
npm run deploy:button -- https://github.com/your-name/pulsegate
```

脚本只更新按钮区块，需要自行提交并推送。Workers Builds 的 Build command 设置 `npm run build`，Deploy command 设置 `npx wrangler deploy && npx wrangler d1 migrations apply DB --remote`。生产 Secret 在部署配置/Worker 设置添加，一键部署不会生成公共默认口令。[部署按钮官方说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

## 连接上游与调用

1. 添加渠道，选择用于模型发现与渠道测试的 OpenAI、Anthropic 或 Gemini 接口类型，填写 API **基础地址**及模型。例如 `https://api.example.com/v1` 加聊天后缀 `/chat/completions`，不要把完整聊天路径当基础地址。
2. 用“密钥管理”添加上游 API Key，多密钥自动轮换；数据库 AES-GCM 加密，页面只返回遮罩。
3. 配置渠道标签、权重、优先级、重试/健康参数。
4. 创建调用方 API Key 并复制唯一一次展示的 `pg_live_...`，设置当前 Profile。
5. 测试场选择“模型网关”和该 Key，验证授权、映射、切换与日志；单渠道直测可定位上游问题。

复制只复制配置，默认停用，不复制凭据；归档不参与调度，删除会删除上游密钥。客户端修改渠道时不能覆盖健康状态、计数等服务端指标。批量导入先完成所有校验和凭据加密，再以 D1 事务统一写入；失败会整批回滚。

OpenAI SDK 的 `base_url` 使用 `https://你的worker地址/v1`。公开入口：`GET /v1/models`、`POST /v1/chat/completions` 和 `POST /v1/messages`。两种公开生成入口保持客户端请求路径与格式，不按渠道接口类型转换请求；调用方需使用上游支持的入口。Key Profile、别名、重试、健康及用量记录共用原有流程。

```bash
curl https://你的worker地址/v1/chat/completions \
  -H "Authorization: Bearer pg_live_替换为真实Token" \
  -H "Content-Type: application/json" \
  -d '{"model":"你的模型或映射名","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

`x-trace-id`、`x-thread-id` 启用会话粘性：先 trace 最近成功渠道，再 thread，失效后正常调度；状态按 Key/Profile/模型隔离。响应的 `x-pulsegate-request-id` 用于查询轨迹，SSE 响应还返回首字耗时/尝试次数。

Anthropic 客户端使用根地址 `https://你的worker地址`，`x-api-key` 填本程序创建的 `pg_live_...`；也支持 Bearer 认证。在 NewAPI 中创建指向本程序的 Anthropic 渠道时，代理地址同样只填根地址，由 NewAPI 添加 `/v1/messages`：

```bash
curl https://你的worker地址/v1/messages \
  -H "x-api-key: pg_live_替换为真实Token" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"你的模型或映射名","max_tokens":1024,"messages":[{"role":"user","content":"你好"}],"stream":true}'
```

Chat Completions 与 Messages 请求均原样转发，渠道选择 OpenAI、Anthropic 或 Gemini 不会触发公开请求的协议转换或参数检测。完整请求参数、内容块和未知扩展字段交由上游处理，包括 thinking、metadata、缓存控制、文档、服务端工具及后续新增字段。响应 JSON 的未知字段、SSE 事件名及内容也保留原样。

网关仍执行路由鉴权、重试与监控，使用渠道密钥替换上游认证，应用明确配置的请求覆盖，并按已配置别名替换请求及 JSON/SSE 响应中的 `model`。Messages 请求的 Anthropic 版本与 beta 协议头继续传给上游。NewAPI 提供 `/v1/messages` 时，可直接通过网关的同名入口调用；余额监控仍独立选择 NewAPI。

### Profile 权限

| 设置 | 语义 |
| --- | --- |
| 全部渠道 | 所有启用且未归档渠道 |
| 标签 `any` / `all` / `none` | 命中任意 / 同时具有全部 / 排除具有任意选定标签的渠道 |
| 指定渠道 | 只用选定渠道 |
| 模型白名单 | 只用选定目标模型；映射名可作为入口，但目标仍受白名单和渠道范围限制 |
| 请求额度 | 当前 Profile 累计请求数；`0`/空/“无限制”不限；调度前原子预留，同次重试不重复扣减 |

标签区分大小写，按标签/指定渠道必须至少选一项，不会因空配置放宽。标签重命名同步全部渠道/Key Profile；未撤销 Key 仍引用的标签不能删除，包含 `none` 排除规则。`/v1/models` 使用同一授权范围。切换 Profile、轮换 Key 保留累计额度。

## 延迟、重试、恢复

TTFT 从发起上游请求计时，直到首个有效文本、推理内容或工具调用；注释/心跳/空事件/仅角色片段不算首字。非流式使用完整响应耗时，两类窗口分别统计，单位为秒。

流式首字延迟只有在最近请求窗口满 `N` 次，且这 `N` 次实际尝试都正常取得首字、首字延迟均严格超过阈值时才降级。一次快请求、失败或没有有效首字的尝试都会打断连续慢请求；时间窗口内不足 `N` 次时不因首字延迟降级。平均 TTFT 仍作为监控指标。非流式在达到最少样本后，平均响应耗时超阈值会降级；两类请求的近期失败比例达到 50% 且满足最少样本时会离线。自动切换启用时，后续排除不健康渠道。

窗口和健康状态在每次尝试完成后写入 D1，仍在输出中的流式请求不会立即改变统计窗口。单次首字硬超时、网络错误、配置的 HTTP 状态及空响应按预算重试，无需等待满健康窗口；已经收到有效首字的慢请求会继续完成，其 TTFT 随完成记录计入窗口。选择自适应策略时，健康渠道仍按平均延迟排序，因此未达到连续慢请求条件也可能选用其他渠道。

例如设置首字阈值 `10`、窗口 `20`、最小样本 `10`、首字超时 `20`，需要连续 `20` 次流式尝试的首字都超过 `10` 秒，才因首字延迟降级；偶发一两次慢请求不会降级，期间一次首字不超过 `10` 秒的请求就会打断连续计数。最小样本 `10` 仅用于失败比例与非流式平均耗时判定。首字超时仍是单次硬截止：达到 `20` 秒未取得首字时即可按预算重试，超时 `0` 关闭该截止。若首字超时不高于健康阈值，请求会先超时，无法形成正常完成的慢请求窗口；需要统计连续慢响应时可调高首字超时或设为 `0`。跨渠道次数是首次失败后最多额外尝试的不同渠道数，单渠道次数是该渠道首次尝试后的额外重试次数。

**已向客户端输出生成内容后，不会拼接另一渠道回复。** 后续网络断流会直接中断响应流并记录错误，不注入 SSE 错误事件；上游自行返回的错误帧原样保留。客户端取消保留请求轨迹，但不进入渠道健康窗口、失败计数或健康历史。鉴权、授权范围等未到达上游的失败也不计为上游健康样本。

指定 HTTP 状态连续失败可自动禁用渠道或上游密钥。每分钟 Cron 最多探测 8 个渠道，冷却后达到连续健康次数才恢复；页面“恢复探测”同样真实发送请求，不直接宣称恢复。上游密钥仅在自动禁用、开启恢复且冷却已结束时参与恢复，手动停用的密钥需手动启用。单次恢复探测有最多 30 秒的整体截止，防止持续空事件或不结束的流阻塞定时任务。探测输出 Token 很少，但仍可能产生费用。日志、尝试及事件按保留天数自动清理。

Cron 每轮最多刷新 5 个后台账户，打开页面时每轮最多刷新 3 个；通过租约和到期时间继续轮转。该批次为失败会话重登和密码加密握手预留子请求预算，适配 [Workers Free 的 50 次外部子请求限制](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)。高重试次数也会消耗子请求预算，配置大规模重试时需结合 Workers 套餐限制。

## AI Gateway 自定义服务商

链路：客户端 → PulseGate（鉴权、质量调度）→ AI Gateway → 模型上游。在 Cloudflare AI Gateway 创建并启用自定义服务商，在 PulseGate 填 Account ID/Gateway ID/Gateway Token，渠道切换 AI Gateway 模式并填 provider slug。

本程序用服务商原生路径，slug 自动加 `custom-`。Cloudflare 自定义服务商 `base_url` 与 provider path 要匹配：例如 `base_url=https://api.example.com`、渠道基础地址 `https://api.example.com/v1`，对应：

```text
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/custom-{slug}/v1/chat/completions
```

上游凭据与 `cf-aig-authorization` 分开认证。Gateway Token 可在控制台加密保存，或用 Worker Secret `AI_GATEWAY_TOKEN`。不要在 `base_url` 和 provider path 重复 `/v1`。[路径组合及认证官方说明](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)

## 存储及边界

D1 保存配置、加密凭据、Key SHA-256 哈希、Profile 计数、健康、尝试、日志、事件、短期路由状态；DO 串行协调健康/额度/轮询/限流。调用方 Token 明文不落库，日志不保存完整提示词或回复，错误写入前脱敏。

公开生成入口仅有 `/v1/chat/completions` 和 `/v1/messages`，按客户端格式转发参数与响应，不设置参数白名单或转换协议。上游是否支持具体字段和内容由该上游决定；渠道接口类型只用于模型获取与渠道测试。当前没有 Responses、embeddings、独立音视频入口或 SMTP/Webhook；通知开关控制控制台提示。HTTP 中继是 HTTPS HTTP 转发地址，非 SOCKS/CONNECT。

已验证本地 Workers/D1/DO 和协议模拟。真实 Cloudflare 账户、Gateway 配置及真实上游凭据需部署后联调。生产不开放 Mock；费用按配置的每百万 Token 价格和上游 usage 计算，无 usage 时不推测准确费用。

## AxonHub 参考

标签、API Key Profile、重试、粘性调度、渠道菜单参考 [AxonHub](https://github.com/looplj/axonhub)，本项目独立实现配置化 TTFT/非流式阈值、显式健康状态及连续恢复，不宣称覆盖 AxonHub 全部业务与协议。
