const MAX_PREVIEW_URL_LENGTH = 4096;
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".onion",
];
export interface LinkPreviewTarget {
  url: string;
  hostname: string;
}

function isBlockedIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

/**
 * Performs a fast renderer-side check before asking the native metadata fetcher.
 * The backend repeats validation and pins DNS to public addresses before making
 * any request; this helper is only a UX gate, not the security boundary.
 */
export function getLinkPreviewTarget(value: string): LinkPreviewTarget | null {
  if (
    !value
    || value.length > MAX_PREVIEW_URL_LENGTH
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
  ) {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".")
    || hostname.includes(":")
    || BLOCKED_HOSTNAMES.has(hostname)
    || BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    || isBlockedIpv4(hostname)
  ) {
    return null;
  }

  return { url: url.href, hostname };
}
