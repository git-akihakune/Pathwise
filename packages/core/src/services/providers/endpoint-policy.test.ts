import { describe, expect, it } from "vitest";
import type { CustomEndpointsMode } from "../../config";
import { ForbiddenError, ValidationError } from "../../errors";
import { checkCustomEndpoint, isPrivateAddress, type LookupFn } from "./endpoint-policy";

const cfg = (customEndpoints: CustomEndpointsMode, allowPrivateEndpoints = false) => ({
  customEndpoints,
  allowPrivateEndpoints,
});
const records: Record<string, string[]> = {
  "mixed.example": ["93.184.215.14", "127.0.0.1"],
  "meta.example": ["169.254.169.254"],
  "public.example": ["93.184.215.14"],
  "v6.example": ["fd00::5"],
};
const lookup: LookupFn = async (h) => records[h] ?? [];

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.20",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
  ])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["93.184.215.14", "172.32.0.1", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s is public",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("checkCustomEndpoint", () => {
  it("off: nobody, not even admins; admin_only: admins only, private addresses allowed", async () => {
    await expect(
      checkCustomEndpoint(cfg("off"), "admin", "http://public.example/v1", lookup),
    ).rejects.toThrow(new ForbiddenError("Custom endpoints are disabled on this instance."));
    await expect(
      checkCustomEndpoint(cfg("admin_only"), "user", "http://public.example/v1", lookup),
    ).rejects.toThrow(new ForbiddenError("Only admins can add custom endpoints on this instance."));
    await expect(
      checkCustomEndpoint(cfg("admin_only"), "admin", "http://127.0.0.1:8080/v1", lookup),
    ).resolves.toBeUndefined();
  });
  it("all: non-admins cannot reach hosts that resolve privately (Review Focus 2)", async () => {
    for (const url of [
      "http://mixed.example/v1",
      "http://meta.example/latest",
      "http://v6.example/v1",
      "http://[::ffff:127.0.0.1]:8080/v1",
      "http://127.0.0.1:8080/v1",
    ]) {
      await expect(checkCustomEndpoint(cfg("all"), "user", url, lookup)).rejects.toThrow(
        /private or local network address/,
      );
    }
    await expect(
      checkCustomEndpoint(cfg("all"), "user", "https://public.example/v1", lookup),
    ).resolves.toBeUndefined();
    await expect(
      checkCustomEndpoint(cfg("all", true), "user", "http://meta.example/v1", lookup),
    ).resolves.toBeUndefined();
  });
  it("rejects non-http URLs and unresolvable hosts", async () => {
    await expect(
      checkCustomEndpoint(cfg("all"), "user", "ftp://public.example", lookup),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      checkCustomEndpoint(cfg("all"), "user", "not a url", lookup),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      checkCustomEndpoint(cfg("all"), "user", "http://nowhere.example", lookup),
    ).rejects.toThrow(/Could not resolve nowhere\.example/);
  });
});
