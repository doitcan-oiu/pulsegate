import { describe, expect, it } from "vitest";
import { defaultChannelConfig } from "../shared/types";
import { changedChannelConfig, channelConfigPatchForPanel } from "../src/channel-config-patch";
import { config as applyConfigPatch } from "../worker/validation";
import type { CredentialMeta, GatewayBalance } from "../shared/types";
import { credentialStatus, credentialUpdates } from "../src/components/channels/credential-utils";
import { balanceAmount } from "../src/channel-balance";

describe("BBDevLab key balance presentation", () => {
  const balance = (amount: number | null, status: GatewayBalance["status"] = "ok"): GatewayBalance => ({ amount, status, unit: "余额", updatedAt: null, checkedAt: null });

  it("preserves tiny spendable balances and shows zero without adding a dollar unit", () => {
    expect(balanceAmount(balance(0.00001))).toBe("0.00001");
    expect(balanceAmount(balance(0.00123))).toBe("0.00123");
    expect(balanceAmount(balance(1335.16262))).toBe("1,335.16262");
    expect(balanceAmount(balance(0))).toBe("0");
  });

  it("distinguishes unknown balances from failed refreshes while retaining the last successful amount", () => {
    expect(balanceAmount(undefined)).toBe("待更新");
    expect(balanceAmount(undefined, "未配置 Key")).toBe("未配置 Key");
    expect(balanceAmount(balance(null, "error"))).toBe("更新失败");
    expect(balanceAmount(balance(0.00123, "error"))).toBe("0.00123");
  });

  it("labels exhausted keys separately from manually disabled keys", () => {
    const key: CredentialMeta = { id: "balance-key", label: "Key", preview: "••••1234", enabled: false, failureCount: 0, disabledAt: null, createdAt: "2026-10-24T00:00:00Z", reason: null };
    expect(credentialStatus(key)).toBe("已停用");
    expect(credentialStatus({ ...key, reason: "BBDevLab 额度耗尽" })).toBe("额度耗尽");
    expect(credentialStatus({ ...key, enabled: true })).toBe("可用");
  });
});

describe("editing saved channel credentials", () => {
  const baseline: CredentialMeta[] = [
    { id: "existing", label: "Original", preview: "••••1234", enabled: true, failureCount: 0, disabledAt: null, createdAt: "2026-10-23T00:00:00Z", reason: null },
    { id: "other", label: "Other", preview: "••••5678", enabled: false, failureCount: 2, disabledAt: null, createdAt: "2026-10-23T00:00:00Z", reason: null },
  ];

  it("preserves empty replacement fields and supports renaming without submitting a secret", () => {
    expect(credentialUpdates([{ id: "existing", label: "Original", secret: "" }], baseline)).toEqual([]);
    expect(credentialUpdates([{ id: "existing", label: " Renamed ", secret: "  " }], baseline)).toEqual([{ id: "existing", label: "Renamed" }]);
  });

  it("replaces only the chosen saved credential and excludes untouched names and credentials", () => {
    expect(credentialUpdates([
      { id: "existing", label: "Original", secret: " replacement-key " },
      { id: "other", label: "Other", secret: "" },
    ], baseline)).toEqual([{ id: "existing", secret: "replacement-key" }]);
  });

  it("rejects invalid edits and stale credential identities before submitting", () => {
    for (const draft of [
      { id: "existing", label: " ", secret: "" },
      { id: "existing", label: "x".repeat(129), secret: "" },
      { id: "existing", label: "Original", secret: "x".repeat(16001) },
      { id: "missing", label: "Original", secret: "replacement" },
    ]) expect(() => credentialUpdates([draft], baseline)).toThrow();
    expect(() => credentialUpdates([{ id: "existing", label: "Original", secret: "a" }, { id: "existing", label: "Original", secret: "b" }], baseline)).toThrow();
  });
});

describe("channel form PATCH isolation", () => {
  it("does not overwrite newer unrelated settings when an alias dialog saves", () => {
    const baseline = structuredClone(defaultChannelConfig);
    const draft = { ...baseline, aliases: [{ from: "public", to: "physical" }] };
    const patch = channelConfigPatchForPanel(draft, baseline, "aliases");
    const latest = { ...baseline, relayUrl: "https://new-relay.example", rateLimit: { requestsPerMinute: 100, tokensPerMinute: 4000 } };
    expect(applyConfigPatch(patch, true, latest)).toMatchObject({ aliases: draft.aliases, relayUrl: latest.relayUrl, rateLimit: latest.rateLimit });
    expect(Object.keys(patch)).toEqual(["aliases"]);
  });

  it("only patches the changed member of a fixed nested config", () => {
    const baseline = structuredClone(defaultChannelConfig);
    const draft = { ...baseline, rateLimit: { ...baseline.rateLimit, requestsPerMinute: 40 } };
    const patch = channelConfigPatchForPanel(draft, baseline, "rateLimit");
    expect(patch).toEqual({ rateLimit: { requestsPerMinute: 40 } });
    const latest = { ...baseline, rateLimit: { ...baseline.rateLimit, tokensPerMinute: 9000 } };
    expect(applyConfigPatch(patch, true, latest).rateLimit).toEqual({ requestsPerMinute: 40, tokensPerMinute: 9000 });
  });

  it("changes one cooldown switch without overwriting the other switch or unrelated panels", () => {
    const baseline = structuredClone(defaultChannelConfig);
    const draft = { ...baseline, relayUrl: "https://unsaved-relay.example", aliases: [{ from: "public", to: "physical" }], cooldown: { ...baseline.cooldown, firstToken: false } };
    const patch = channelConfigPatchForPanel(draft, baseline, "autoDisable");
    expect(patch).toEqual({ cooldown: { firstToken: false } });
    const latest = { ...baseline, relayUrl: "https://new-relay.example", cooldown: { firstToken: true, error: false } };
    expect(applyConfigPatch(patch, true, latest)).toMatchObject({ relayUrl: latest.relayUrl, aliases: [], cooldown: { firstToken: false, error: false } });
    expect(channelConfigPatchForPanel(draft, baseline, "aliases")).toEqual({ aliases: draft.aliases });
  });

  it("defaults legacy cooldown switches to enabled and sends explicit false values", () => {
    const baseline = structuredClone(defaultChannelConfig);
    delete (baseline as Partial<typeof baseline>).cooldown;
    expect(changedChannelConfig({ cooldown: { firstToken: true, error: true } }, baseline)).toEqual({});
    expect(changedChannelConfig({ cooldown: { firstToken: true, error: false } }, baseline)).toEqual({ cooldown: { error: false } });
  });

  it("keeps auto-disable edits isolated from concurrent cooldown changes", () => {
    const baseline = structuredClone(defaultChannelConfig);
    const draft = { ...baseline, autoDisable: { ...baseline.autoDisable, enabled: true } };
    const patch = channelConfigPatchForPanel(draft, baseline, "autoDisable");
    expect(patch).toEqual({ autoDisable: { enabled: true } });
    const latest = { ...baseline, cooldown: { firstToken: false, error: false } };
    expect(applyConfigPatch(patch, true, latest)).toMatchObject({ autoDisable: draft.autoDisable, cooldown: latest.cooldown });
  });

  it("preserves complete override dictionaries and explicitly sends deletions", () => {
    const baseline = { ...structuredClone(defaultChannelConfig), headers: { "x-old": "old", "x-keep": "keep" }, bodyOverrides: { temperature: 1 } };
    const draft = { ...baseline, headers: { "x-keep": "keep" }, bodyOverrides: {} };
    expect(channelConfigPatchForPanel(draft, baseline, "overrides")).toEqual({ headers: { "x-keep": "keep" }, bodyOverrides: {} });
  });

  it("keeps empty replacement arrays and removes untouched connection fields", () => {
    const baseline = { ...structuredClone(defaultChannelConfig), aliases: [{ from: "old", to: "old-model" }] };
    expect(channelConfigPatchForPanel({ ...baseline, aliases: [] }, baseline, "aliases")).toEqual({ aliases: [] });
    expect(changedChannelConfig({ protocol: baseline.protocol, relayUrl: "https://relay.example", gatewayMode: baseline.gatewayMode }, baseline)).toEqual({ relayUrl: "https://relay.example" });
    expect(changedChannelConfig(baseline, baseline)).toEqual({});
  });
});
