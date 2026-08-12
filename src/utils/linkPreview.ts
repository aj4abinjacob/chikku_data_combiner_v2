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
const GOOGLE_EDITOR_PATH = /^\/(spreadsheets|document|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)\/(?:edit|view|preview|htmlview)\/?$/;
const GOOGLE_SHEET_GID = /^\d{1,20}$/;

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

function getEmbeddableUrl(url: URL): URL {
  if (url.origin !== "https://docs.google.com") return url;

  const match = GOOGLE_EDITOR_PATH.exec(url.pathname);
  if (!match) return url;

  const previewUrl = new URL(`/${match[1]}/d/${match[2]}/preview`, url.origin);
  if (match[1] === "spreadsheets") {
    const fragmentGid = new URLSearchParams(url.hash.slice(1)).get("gid");
    const gid = [url.searchParams.get("gid"), fragmentGid]
      .find((candidate): candidate is string => !!candidate && GOOGLE_SHEET_GID.test(candidate));
    if (gid) previewUrl.searchParams.set("gid", gid);
  }
  return previewUrl;
}

/**
 * Allows public HTTPS pages to be tried in the sandboxed hover preview while
 * rejecting URLs that could target the local machine or private network.
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

  return { url: getEmbeddableUrl(url).href, hostname };
}
