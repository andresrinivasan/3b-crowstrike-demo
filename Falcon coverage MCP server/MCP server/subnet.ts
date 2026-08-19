export type Subnet = {
  label: string;
  /** First address of the range, dotted quad — the inclusive lower bound of an FQL IP comparison. */
  first: string;
  /** Last address of the range, dotted quad — the inclusive upper bound. */
  last: string;
  contains: (ip: string | undefined) => boolean;
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const OCTET_PREFIX = /^(\d{1,3}\.){1,3}$/;

function toInt(ip: string): number | null {
  const match = ip.match(IPV4);
  if (!match) return null;

  const octets = match.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return null;

  return octets.reduce((acc, o) => acc * 256 + o, 0);
}

const toQuad = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

const unreadable = (raw: string) =>
  new Error(
    `Cannot read "${raw}" as a subnet. Use CIDR ("10.4.0.0/16"), an octet prefix ("10.4.*"), or a single IPv4 address.`,
  );

// Both the Hosts and the Discover query APIs compare IPs numerically and accept inclusive bounds
// (verified against the live tenant), so a range is expressed exactly rather than widened to the
// containing octet-aligned prefix a wildcard would force.
function range(network: number, bits: number): Subnet {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const base = (network & mask) >>> 0;
  const broadcast = (base | (~mask >>> 0)) >>> 0;

  return {
    label: bits === 32 ? toQuad(base) : `${toQuad(base)}/${bits}`,
    first: toQuad(base),
    last: toQuad(broadcast),
    contains: (ip) => {
      const value = ip === undefined ? null : toInt(ip);
      return value !== null && value >= base && value <= broadcast;
    },
  };
}

export function parseSubnet(raw: string): Subnet {
  const input = raw.trim();

  // "10.4.*" and "10.4." both mean the /16 — an octet prefix carries its own implied length.
  if (input.endsWith("*") || OCTET_PREFIX.test(input)) {
    const prefix = input.replace(/\*$/, "");
    const octets = prefix.split(".").slice(0, -1);
    if (!OCTET_PREFIX.test(prefix) || octets.some((o) => Number(o) > 255)) throw unreadable(raw);

    const padded = [...octets, ...Array(4 - octets.length).fill("0")].join(".");
    const base = toInt(padded);
    if (base === null) throw unreadable(raw);

    return { ...range(base, octets.length * 8), label: `${prefix}*` };
  }

  const [address, bitsRaw] = input.split("/");
  const base = toInt(address ?? "");
  if (base === null) throw unreadable(raw);

  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 8 || bits > 32) {
    throw new Error(
      `Prefix length /${bitsRaw} is not supported. Use /8 through /32 — anything wider sweeps the whole fleet rather than a subnet.`,
    );
  }

  return range(base, bits);
}
