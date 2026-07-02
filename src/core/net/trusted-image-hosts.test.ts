import { afterEach, describe, expect, it, vi } from "vitest";
import { saveSettings } from "../settings/settings";
import {
  getTrustedImageHostsSnapshot,
  isImageHostTrusted,
  resetTrustedImageHostsForTests,
  seedTrustedImageHosts,
  subscribeTrustedImageHosts,
  trustImageHost,
} from "./trusted-image-hosts";

vi.mock("../settings/settings", () => ({ saveSettings: vi.fn(async () => ({})) }));

describe("trusted-image-hosts", () => {
  afterEach(() => {
    resetTrustedImageHostsForTests();
    vi.mocked(saveSettings).mockClear();
  });

  it("seeds and matches hosts case-insensitively", () => {
    seedTrustedImageHosts(["CDN.Example.com"]);
    expect(isImageHostTrusted("cdn.example.com")).toBe(true);
    expect(isImageHostTrusted("CDN.EXAMPLE.COM")).toBe(true);
    expect(isImageHostTrusted("other.com")).toBe(false);
    expect(getTrustedImageHostsSnapshot()).toEqual(["cdn.example.com"]);
  });

  it("trustImageHost adds, notifies subscribers, and persists", async () => {
    const listener = vi.fn();
    subscribeTrustedImageHosts(listener);
    await trustImageHost("Example.com");
    expect(isImageHostTrusted("example.com")).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith({ trusted_image_hosts: ["example.com"] });
  });

  it("trustImageHost is a no-op (no persist) when already trusted", async () => {
    seedTrustedImageHosts(["example.com"]);
    await trustImageHost("example.com");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns a stable snapshot reference when unchanged", () => {
    seedTrustedImageHosts(["a.com"]);
    expect(getTrustedImageHostsSnapshot()).toBe(getTrustedImageHostsSnapshot());
  });
});
