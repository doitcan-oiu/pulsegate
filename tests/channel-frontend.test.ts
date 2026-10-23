import { describe, expect, it } from "vitest";
import { defaultChannelConfig } from "../shared/types";
import { changedChannelConfig, channelConfigPatchForPanel } from "../src/channel-config-patch";
import { config as applyConfigPatch } from "../worker/validation";

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
