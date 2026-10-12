import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { AppConfig } from "../../config";
import { ForbiddenError, ValidationError } from "../../errors";

export type LookupFn = (host: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((r) => r.address);

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);

/** Real resolvers reject for unknown hosts instead of returning an empty list. */
async function resolveHost(lookup: LookupFn, host: string): Promise<string[]> {
  try {
    return await lookup(host);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && NOT_FOUND_CODES.has(code)) return [];
    throw err;
  }
}

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

/** Expands an IPv6 literal (optionally ending in a dotted quad) to 8 numeric groups. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = (dotted[2] as string).split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) return null;
    const [a, b, c, d] = parts as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail = halves[1] ? (halves[1] as string).split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for loopback, link-local, private, CGNAT and unspecified addresses (IPv4-mapped IPv6 included). */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return PRIVATE.check(ip, "ipv4");
  if (family === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true; // unparseable: fail closed
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      const v4 = `${(g[6] as number) >> 8}.${(g[6] as number) & 255}.${(g[7] as number) >> 8}.${(g[7] as number) & 255}`;
      return PRIVATE.check(v4, "ipv4");
    }
    return PRIVATE.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
  }
  return true; // not an IP at all: fail closed
}

export async function checkCustomEndpoint(
  config: Pick<AppConfig, "customEndpoints" | "allowPrivateEndpoints">,
  role: "admin" | "user",
  baseUrl: string,
  lookup: LookupFn = defaultLookup,
): Promise<void> {
  if (config.customEndpoints === "off") {
    throw new ForbiddenError("Custom endpoints are disabled on this instance.");
  }
  if (config.customEndpoints === "admin_only" && role !== "admin") {
    throw new ForbiddenError("Only admins can add custom endpoints on this instance.");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ValidationError("Base URL must be an http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Base URL must be an http(s) URL.");
  }
  if (role === "admin" || config.allowPrivateEndpoints) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolveHost(lookup, host);
  if (addresses.length === 0) throw new ValidationError(`Could not resolve ${host}.`);
  const bad = addresses.find(isPrivateAddress);
  if (bad) {
    throw new ForbiddenError(
      `This endpoint resolves to a private or local network address (${bad}), which is not allowed. Ask your admin to set ALLOW_PRIVATE_ENDPOINTS=true if this is intended.`,
    );
  }
}
