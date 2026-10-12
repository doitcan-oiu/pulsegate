import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Chip } from "@heroui/react";
import {
  ArrowRight,
  Braces,
  Calculator,
  CircleDollarSign,
  FileKey2,
  Plus,
  Settings2,
  Tags,
  Trash2,
} from "lucide-react";
import type { ChannelConfig } from "../shared/types";
import { Button, Input, Select, TextArea } from "./ui";
import { PanelEmpty, PanelNumber, PanelSection } from "./ChannelPanelUI";
import "./channel-model-panels.css";

type ModelProps = {
  config: ChannelConfig;
  setConfig: Dispatch<SetStateAction<ChannelConfig>>;
  models: string[];
};

export function ModelAliasesPanel({ config, setConfig, models }: ModelProps) {
  const add = (to = "") =>
    setConfig((old) => ({
      ...old,
      aliases: [...old.aliases, { from: "", to }],
    }));
  const update = (index: number, key: "from" | "to", value: string) =>
    setConfig((old) => ({
      ...old,
      aliases: old.aliases.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    }));
  return (
    <PanelSection
      title="模型名称映射"
      description="客户端使用公开名称，网关转发时替换成上游模型名称。"
      icon={Tags}
      action={
        <Button onClick={() => add()}>
          <Plus size={15} />
          添加映射
        </Button>
      }
    >
      {config.aliases.length === 0 ? (
        <PanelEmpty
          icon={Tags}
          title="还没有模型别名"
          description="例如：客户端请求 assistant，上游实际使用 gpt-4.1。"
          action={
            <Button variant="primary" onClick={() => add()}>
              添加第一条映射
            </Button>
          }
        />
      ) : (
        <div className="cmp-list">
          {config.aliases.map((alias, index) => {
            const duplicate =
              alias.from.trim() &&
              config.aliases.some(
                (other, i) =>
                  i !== index && other.from.trim() === alias.from.trim(),
              );
            return (
              <div className="cmp-entry" key={index}>
                <div className="cmp-entry-heading">
                  <span>映射 {String(index + 1).padStart(2, "0")}</span>
                  <Button
                    variant="ghost"
                    isIconOnly
                    aria-label={`删除映射 ${index + 1}`}
                    onClick={() =>
                      setConfig((old) => ({
                        ...old,
                        aliases: old.aliases.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
                <div className="cmp-alias-fields">
                  <label className="cmp-field">
                    <span>公开模型名</span>
                    <Input
                      aria-label={`公开模型名 ${index + 1}`}
                      value={alias.from}
                      placeholder="例如 assistant"
                      onChange={(e) => update(index, "from", e.target.value)}
                      aria-invalid={Boolean(duplicate)}
                    />
                  </label>
                  <ArrowRight className="cmp-map-arrow" size={18} />
                  <label className="cmp-field">
                    <span>上游模型名</span>
                    <Input
                      aria-label={`上游模型名 ${index + 1}`}
                      value={alias.to}
                      placeholder="例如 gpt-4.1"
                      onChange={(e) => update(index, "to", e.target.value)}
                    />
                  </label>
                </div>
                {duplicate ? (
                  <p className="cmp-error" role="alert">
                    公开模型名重复，请为每条映射使用不同的名称。
                  </p>
                ) : (
                  <p className="cmp-row-note">
                    请求 <code>{alias.from || "公开模型"}</code>
                    <ArrowRight size={12} />
                    转发 <code>{alias.to || "上游模型"}</code>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {models.length > 0 && (
        <div className="cmp-suggestions">
          <span>从渠道模型开始</span>
          <div>
            {models.slice(0, 10).map((model) => (
              <Button
                key={model}
                variant="ghost"
                size="sm"
                onClick={() => add(model)}
              >
                <Plus size={12} />
                {model}
              </Button>
            ))}
            {models.length > 10 && (
              <Chip size="sm">另有 {models.length - 10} 个模型</Chip>
            )}
          </div>
        </div>
      )}
    </PanelSection>
  );
}

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);

export function ModelPricesPanel({ config, setConfig, models }: ModelProps) {
  const [inputTokens, setInputTokens] = useState(1000);
  const [outputTokens, setOutputTokens] = useState(500);
  const add = (model = "") =>
    setConfig((old) => ({
      ...old,
      prices: [...old.prices, { model, input: 0, output: 0 }],
    }));
  const update = (
    index: number,
    patch: Partial<ChannelConfig["prices"][number]>,
  ) =>
    setConfig((old) => ({
      ...old,
      prices: old.prices.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  return (
    <div className="cmp-panels">
      <PanelSection
        title="模型单价"
        description="以 USD / 百万 token 记录输入与输出价格，用于请求成本统计。"
        icon={CircleDollarSign}
        action={
          <Button onClick={() => add()}>
            <Plus size={15} />
            添加价格
          </Button>
        }
      >
        {config.prices.length === 0 ? (
          <PanelEmpty
            icon={CircleDollarSign}
            title="还没有设置价格"
            description="为上游模型填写输入与输出单价，用于用量分析中的成本计算。"
            action={
              <Button variant="primary" onClick={() => add()}>
                添加模型价格
              </Button>
            }
          />
        ) : (
          <div className="cmp-list">
            {config.prices.map((price, index) => {
              const duplicate =
                price.model.trim() &&
                config.prices.some(
                  (other, i) =>
                    i !== index && other.model.trim() === price.model.trim(),
                );
              const cost =
                (price.input * inputTokens + price.output * outputTokens) / 1e6;
              return (
                <div className="cmp-entry" key={index}>
                  <div className="cmp-entry-heading">
                    <span>模型 {String(index + 1).padStart(2, "0")}</span>
                    <Button
                      variant="ghost"
                      isIconOnly
                      aria-label={`删除价格 ${index + 1}`}
                      onClick={() =>
                        setConfig((old) => ({
                          ...old,
                          prices: old.prices.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <label className="cmp-field">
                    <span>上游模型名称</span>
                    <Input
                      aria-label={`价格模型名称 ${index + 1}`}
                      value={price.model}
                      placeholder="填写上游实际模型名称"
                      onChange={(e) => update(index, { model: e.target.value })}
                      aria-invalid={Boolean(duplicate)}
                    />
                  </label>
                  <div className="cmp-price-fields">
                    <PanelNumber
                      label={`输入单价 ${index + 1}`}
                      value={price.input}
                      onChange={(input) => update(index, { input })}
                      min={0}
                      max={1000000}
                      step={0.1}
                      unit="USD / 百万 token"
                      formatOptions={{ maximumFractionDigits: 20 }}
                    />
                    <PanelNumber
                      label={`输出单价 ${index + 1}`}
                      value={price.output}
                      onChange={(output) => update(index, { output })}
                      min={0}
                      max={1000000}
                      step={0.1}
                      unit="USD / 百万 token"
                      formatOptions={{ maximumFractionDigits: 20 }}
                    />
                  </div>
                  {duplicate && (
                    <p className="cmp-error" role="alert">
                      该模型已有价格，请保留一条价格记录。
                    </p>
                  )}
                  <div className="cmp-cost">
                    <span>
                      {inputTokens.toLocaleString()} 输入 +{" "}
                      {outputTokens.toLocaleString()} 输出 token
                    </span>
                    <strong>
                      {Number.isFinite(cost) ? dollars(cost) : "填写有效价格"}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {models.some(
          (model) => !config.prices.some((price) => price.model === model),
        ) && (
          <div className="cmp-suggestions">
            <span>快速添加渠道模型</span>
            <div>
              {models
                .filter(
                  (model) =>
                    !config.prices.some((price) => price.model === model),
                )
                .slice(0, 10)
                .map((model) => (
                  <Button
                    key={model}
                    variant="ghost"
                    size="sm"
                    onClick={() => add(model)}
                  >
                    <Plus size={12} />
                    {model}
                  </Button>
                ))}
            </div>
          </div>
        )}
      </PanelSection>
      <PanelSection
        title="单次请求成本预览"
        description="调整预估用量，上方每个模型会实时显示成本；预览用量不会保存。"
        icon={Calculator}
      >
        <div className="cmp-price-fields">
          <PanelNumber
            label="预估输入 token"
            value={inputTokens}
            onChange={setInputTokens}
            min={0}
            max={1000000000}
            step={100}
          />
          <PanelNumber
            label="预估输出 token"
            value={outputTokens}
            onChange={setOutputTokens}
            min={0}
            max={1000000000}
            step={100}
          />
        </div>
        <p className="cmp-row-note">
          成本 = 输入 token × 输入单价 ÷ 1,000,000 + 输出 token × 输出单价 ÷
          1,000,000
        </p>
      </PanelSection>
    </div>
  );
}

export type OverrideRow = {
  id: string;
  key: string;
  type: "string" | "number" | "boolean" | "json" | "null";
  value: string;
};
const sensitiveHeaderName =
  /(authorization|api[-_]?key|token|secret|password|cookie|host|content-length|connection|transfer-encoding)/i;
const sensitiveValue = /Bearer\s|(?:sk-|AIza|pg_live_)[A-Za-z0-9_-]{12,}/i;
const protectedBody = new Set([
  "model",
  "stream",
  "messages",
  "contents",
  "system",
  "systemInstruction",
]);
function containsCredential(value: unknown): boolean {
  if (typeof value === "string") return sensitiveValue.test(value);
  if (Array.isArray(value)) return value.some(containsCredential);
  if (value && typeof value === "object")
    return Object.entries(value).some(
      ([key, val]) =>
        /^(?:api[-_]?key|access[-_]?token|token|secret|password|authorization)$/i.test(
          key,
        ) || containsCredential(val),
    );
  return false;
}
function containsNonFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNonFinite);
  if (value && typeof value === "object")
    return Object.values(value).some(containsNonFinite);
  return false;
}

export function overridesToRows(
  record: Record<string, unknown>,
  headers = false,
): OverrideRow[] {
  return Object.entries(record).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    type:
      headers || typeof value === "string"
        ? "string"
        : value === null
          ? "null"
          : typeof value === "number"
            ? "number"
            : typeof value === "boolean"
              ? "boolean"
              : "json",
    value:
      typeof value === "string"
        ? value
        : value === null
          ? ""
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : JSON.stringify(value, null, 2),
  }));
}

function parseOverrideRow(row: OverrideRow, headers: boolean): unknown {
  if (!row.key.trim()) throw new Error("请填写键名，或删除此行");
  if (headers) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(row.key))
      throw new Error("请求头名称包含无效字符");
    if (sensitiveHeaderName.test(row.key))
      throw new Error("认证和传输头由网关管理，请使用密钥管理");
    if (row.value.length > 2048 || /[\r\n]/.test(row.value))
      throw new Error("请求头值须为单行文本，最长 2048 字符");
    if (sensitiveValue.test(row.value))
      throw new Error("凭证请保存在密钥管理中");
    return row.value;
  }
  if (protectedBody.has(row.key)) throw new Error("该参数由网关管理，不能覆盖");
  let value: unknown;
  switch (row.type) {
    case "string":
      value = row.value;
      break;
    case "number":
      if (
        !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(row.value.trim()) ||
        !Number.isFinite(Number(row.value))
      )
        throw new Error("请填写有效数值");
      value = Number(row.value);
      break;
    case "boolean":
      if (row.value !== "true" && row.value !== "false")
        throw new Error("请选择 true 或 false");
      value = row.value === "true";
      break;
    case "null":
      value = null;
      break;
    case "json":
      try {
        value = JSON.parse(row.value);
      } catch {
        throw new Error("JSON 格式有误，请检查此参数值");
      }
      break;
    default:
      throw new Error("请选择有效参数类型");
  }
  if (containsNonFinite(value)) throw new Error("参数值包含超出范围的数值");
  if (containsCredential({ [row.key]: value }))
    throw new Error("请求参数不能包含凭证，请使用密钥管理");
  return value;
}

export function serializeOverrides(
  rows: OverrideRow[],
  headers = false,
): Record<string, unknown> {
  const keys = new Set<string>();
  const entries = rows.map((row, index) => {
    const key = headers ? row.key.toLowerCase() : row.key;
    if (keys.has(key))
      throw new Error(
        `${headers ? "请求头" : "请求参数"}第 ${index + 1} 行：键名重复`,
      );
    keys.add(key);
    try {
      return [row.key, parseOverrideRow(row, headers)] as const;
    } catch (error) {
      throw new Error(
        `${headers ? "请求头" : "请求参数"}第 ${index + 1} 行：${error instanceof Error ? error.message : "格式无效"}`,
      );
    }
  });
  const result = Object.fromEntries(entries);
  if (headers && rows.length > 30) throw new Error("自定义请求头最多 30 条");
  if (!headers && JSON.stringify(result).length > 32000)
    throw new Error("请求参数配置不能超过 32,000 字符");
  return result;
}

function rowIssue(
  row: OverrideRow,
  rows: OverrideRow[],
  headers: boolean,
): string | undefined {
  if (
    rows.some(
      (other) =>
        other.id !== row.id &&
        (headers
          ? other.key.toLowerCase() === row.key.toLowerCase()
          : other.key === row.key),
    )
  )
    return "键名重复";
  try {
    parseOverrideRow(row, headers);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "格式无效";
  }
}

function OverrideRows({
  rows,
  setRows,
  headers = false,
}: {
  rows: OverrideRow[];
  setRows: Dispatch<SetStateAction<OverrideRow[]>>;
  headers?: boolean;
}) {
  const add = (key = "", type: OverrideRow["type"] = "string", value = "") =>
    setRows((old) => [...old, { id: crypto.randomUUID(), key, type, value }]);
  const update = (id: string, patch: Partial<OverrideRow>) =>
    setRows((old) =>
      old.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  const label = headers ? "请求头" : "请求参数";
  return (
    <PanelSection
      title={headers ? "自定义请求头" : "请求参数覆盖"}
      description={
        headers
          ? "添加项目标识或上游需要的非敏感请求头。"
          : "转发时用这些值覆盖同名参数；每一行独立设置值的类型。"
      }
      icon={headers ? FileKey2 : Settings2}
      action={
        <Button onClick={() => add()}>
          <Plus size={15} />
          添加{label}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={headers ? FileKey2 : Braces}
          title={`未添加${label}`}
          description={
            headers
              ? "例如 X-Project: my-project。认证信息通过上游密钥管理配置。"
              : "例如固定 temperature 为 0.7，或传入模型需要的自定义参数。"
          }
          action={
            <Button
              onClick={() =>
                headers ? add("X-Project") : add("temperature", "number", "0.7")
              }
            >
              添加示例{label}
            </Button>
          }
        />
      ) : (
        <div className="cmp-list">
          {rows.map((row, index) => {
            const issue = rowIssue(row, rows, headers);
            return (
              <div className="cmp-entry" key={row.id}>
                <div className="cmp-entry-heading">
                  <span>
                    {label} {String(index + 1).padStart(2, "0")}
                  </span>
                  <Button
                    variant="ghost"
                    isIconOnly
                    aria-label={`删除${label} ${index + 1}`}
                    onClick={() =>
                      setRows((old) => old.filter((item) => item.id !== row.id))
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
                <div
                  className={
                    headers ? "cmp-header-fields" : "cmp-override-fields"
                  }
                >
                  <label className="cmp-field">
                    <span>{headers ? "名称" : "参数名"}</span>
                    <Input
                      aria-label={`${label}键 ${index + 1}`}
                      value={row.key}
                      onChange={(e) => update(row.id, { key: e.target.value })}
                      placeholder={headers ? "X-Project" : "temperature"}
                    />
                  </label>
                  {!headers && (
                    <label className="cmp-field">
                      <span>值类型</span>
                      <Select
                        aria-label={`请求参数类型 ${index + 1}`}
                        value={row.type}
                        onChange={(e) => {
                          const type = e.target.value as OverrideRow["type"];
                          update(row.id, {
                            type,
                            ...(type === "boolean" &&
                            row.value !== "true" &&
                            row.value !== "false"
                              ? { value: "false" }
                              : {}),
                            ...(type === "null" ? { value: "" } : {}),
                          });
                        }}
                      >
                        <option value="string">文本</option>
                        <option value="number">数字</option>
                        <option value="boolean">布尔值</option>
                        <option value="json">JSON / 对象 / 数组</option>
                        <option value="null">null</option>
                      </Select>
                    </label>
                  )}
                  <label className="cmp-field">
                    <span>值</span>
                    {!headers && row.type === "boolean" ? (
                      <Select
                        aria-label={`${label}值 ${index + 1}`}
                        value={row.value}
                        onChange={(e) =>
                          update(row.id, { value: e.target.value })
                        }
                      >
                        <option value="true">true · 是</option>
                        <option value="false">false · 否</option>
                      </Select>
                    ) : !headers && row.type === "null" ? (
                      <div className="cmp-null">
                        <Chip size="sm">null</Chip>
                        <span>空值，无需输入</span>
                      </div>
                    ) : !headers && row.type === "json" ? (
                      <TextArea
                        aria-label={`${label}值 ${index + 1}`}
                        className="cmp-json-value"
                        value={row.value}
                        rows={3}
                        spellCheck={false}
                        placeholder={'{"enabled": true}'}
                        onChange={(e) =>
                          update(row.id, { value: e.target.value })
                        }
                      />
                    ) : (
                      <Input
                        aria-label={`${label}值 ${index + 1}`}
                        value={row.value}
                        inputMode={
                          !headers && row.type === "number"
                            ? "decimal"
                            : undefined
                        }
                        placeholder={
                          !headers && row.type === "number" ? "0.7" : "输入值"
                        }
                        onChange={(e) =>
                          update(row.id, { value: e.target.value })
                        }
                      />
                    )}
                  </label>
                </div>
                {issue && (
                  <p className="cmp-error" role="alert">
                    {issue}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="cmp-row-note">
        {headers
          ? "Authorization、API Key、Cookie 等认证与传输头由网关管理。"
          : "model、stream、消息与系统提示由网关管理。数字 0、布尔值 false 与 null 会按原类型保存。"}
      </p>
    </PanelSection>
  );
}

export function OverridesPanel({
  headerRows,
  setHeaderRows,
  bodyRows,
  setBodyRows,
}: {
  headerRows: OverrideRow[];
  setHeaderRows: Dispatch<SetStateAction<OverrideRow[]>>;
  bodyRows: OverrideRow[];
  setBodyRows: Dispatch<SetStateAction<OverrideRow[]>>;
}) {
  return (
    <div className="cmp-panels">
      <OverrideRows rows={headerRows} setRows={setHeaderRows} headers />
      <OverrideRows rows={bodyRows} setRows={setBodyRows} />
    </div>
  );
}
