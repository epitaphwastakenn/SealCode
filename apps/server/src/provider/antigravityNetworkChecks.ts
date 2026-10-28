// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - raw sockets pinned to one address family, with their own deadlines, timings and a comparison against the server's Date header.
import * as NodeDns from "node:dns";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import { trustedCaCertificates } from "./antigravityTrust.ts";

/** Hosts the agent and Harp reach for Antigravity, seen through a logging proxy. */
export const ANTIGRAVITY_GOOGLE_HOSTS = [
  "oauth2.googleapis.com",
  "accounts.google.com",
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "dl.google.com",
] as const;

/** The HTTP proxy the agent's Python uses; SOCKS proxies are not probed. */
export const agentProxyUrl = (environment: NodeJS.ProcessEnv) =>
  [environment.HTTPS_PROXY, environment.https_proxy, environment.ALL_PROXY, environment.all_proxy]
    .map((value) => value?.trim())
    .find((value) => value !== undefined && /^http:\/\//i.test(value));

const CONNECT_TIMEOUT_MS = 6_000;
const TLS_TIMEOUT_MS = 8_000;
const HTTP_TIMEOUT_MS = 8_000;
const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

/** Through the OS resolver, which also applies the hosts file; each entry is addresses or an error. */
export interface DnsResult {
  readonly ipv4: ReadonlyArray<string> | string;
  readonly ipv6: ReadonlyArray<string> | string;
}

export interface TlsResult {
  readonly connectMs?: number;
  readonly tlsMs?: number;
  readonly address?: string;
  /** Verified against Node's roots plus the operating system's. */
  readonly trusted?: boolean;
  readonly trustError?: string;
  /** Leaf first. */
  readonly chain?: ReadonlyArray<string>;
  /** Organization or name of the leaf's issuer when it is not Google's own CA. */
  readonly interceptedBy?: string;
  readonly httpStatus?: number;
  readonly httpMs?: number;
  /** Server time minus local time. */
  readonly clockSkewMs?: number;
  readonly failedAt?: "proxy" | "connect" | "tls" | "http";
  readonly error?: string;
}

const errorText = (error: unknown) => {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code && !error.message.includes(code) ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
};

const settle = <A>(promise: Promise<A>) =>
  promise.then(
    (value) => value,
    (error: unknown) => errorText(error),
  );

const withTimeout = <A>(promise: Promise<A>, ms: number, label: string) =>
  new Promise<A>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const lookupFamily = (host: string, family: 4 | 6) =>
  settle(
    withTimeout(
      NodeDns.promises.lookup(host, { all: true, family }),
      CONNECT_TIMEOUT_MS,
      `IPv${family} lookup`,
    ).then((entries) => entries.map((entry) => entry.address)),
  );

export const resolveHost = async (host: string): Promise<DnsResult> => {
  const [ipv4, ipv6] = await Promise.all([lookupFamily(host, 4), lookupFamily(host, 6)]);
  return { ipv4, ipv6 };
};

const firstValue = (value: string | ReadonlyArray<string> | undefined) =>
  typeof value === "string" ? value : value?.[0];

const describeName = (name: NodeTls.PeerCertificate["subject"] | undefined) =>
  [firstValue(name?.O), firstValue(name?.CN)].filter(Boolean).join(" / ") || "unnamed";

const describeChain = (leaf: NodeTls.DetailedPeerCertificate) => {
  const chain: string[] = [];
  let current: NodeTls.DetailedPeerCertificate | undefined = leaf;
  while (current !== undefined && chain.length < 6) {
    chain.push(describeName(current.subject));
    const issuer: NodeTls.DetailedPeerCertificate | undefined = current.issuerCertificate;
    if (issuer === undefined || issuer === current) {
      if (describeName(current.issuer) !== chain.at(-1)) chain.push(describeName(current.issuer));
      break;
    }
    current = issuer;
  }
  return chain;
};

/** Google serves its own hosts with certificates from its own CA, Google Trust Services. */
export const interceptingIssuer = (leaf: Pick<NodeTls.PeerCertificate, "issuer">) => {
  const organization = firstValue(leaf.issuer?.O) ?? "";
  return /Google Trust Services|^Google/i.test(organization)
    ? undefined
    : describeName(leaf.issuer);
};

const connectSocket = (address: string, port: number, family: 4 | 6) =>
  new Promise<NodeNet.Socket>((resolve, reject) => {
    const socket = NodeNet.connect({ host: address, port, family, autoSelectFamily: false });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
      socket.destroy(new Error(`connect timed out after ${CONNECT_TIMEOUT_MS} ms`)),
    );
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("error", reject);
  });

class ProxyUnreachableError extends Error {}

const connectThroughProxy = (proxyUrl: string, host: string, port: number) =>
  new Promise<NodeNet.Socket>((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const request = NodeHttp.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: "CONNECT",
      path: `${host}:${port}`,
      timeout: CONNECT_TIMEOUT_MS * 2,
    });
    request.once("connect", (response, socket) => {
      if (response.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new Error(`the proxy could not reach ${host} (HTTP ${response.statusCode})`));
      }
    });
    request.once("timeout", () => request.destroy(new Error("the proxy did not answer")));
    request.once("error", (error) =>
      reject(new ProxyUnreachableError(`proxy ${proxyUrl} unreachable: ${errorText(error)}`)),
    );
    request.end();
  });

const handshake = (socket: NodeNet.Socket, host: string) =>
  new Promise<NodeTls.TLSSocket>((resolve, reject) => {
    const tls = NodeTls.connect({
      socket,
      servername: host,
      ca: [...trustedCaCertificates()],
      // Inspect what was presented, trusted or not; nothing is sent but a HEAD request.
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    tls.setTimeout(TLS_TIMEOUT_MS, () =>
      tls.destroy(new Error(`TLS handshake timed out after ${TLS_TIMEOUT_MS} ms`)),
    );
    tls.once("secureConnect", () => {
      tls.setTimeout(0);
      resolve(tls);
    });
    tls.once("error", reject);
  });

const headRequest = (tls: NodeTls.TLSSocket, host: string) =>
  new Promise<{ status: number; date: string | undefined }>((resolve, reject) => {
    let response = "";
    tls.setTimeout(HTTP_TIMEOUT_MS, () =>
      tls.destroy(new Error(`HTTP response timed out after ${HTTP_TIMEOUT_MS} ms`)),
    );
    tls.on("data", (chunk: Buffer) => {
      response += chunk.toString("latin1");
      const end = response.indexOf("\r\n\r\n");
      if (end === -1 && response.length < 16_384) return;
      const head = response.slice(0, end === -1 ? undefined : end);
      const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1]);
      const date = /^date:\s*(.+)$/im.exec(head)?.[1]?.trim();
      tls.destroy();
      if (Number.isNaN(status)) reject(new Error("not an HTTP response"));
      else resolve({ status, date });
    });
    tls.once("error", reject);
    tls.once("close", () => reject(new Error("connection closed before an HTTP response")));
    tls.write(
      `HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Harp-diagnostics\r\nConnection: close\r\n\r\n`,
    );
  });

/** One TCP + TLS + HTTP round trip, direct to `address` or through an HTTP CONNECT proxy. */
export const probeTls = async (
  host: string,
  target: { readonly address: string; readonly family: 4 | 6 } | { readonly proxyUrl: string },
  port = 443,
): Promise<TlsResult> => {
  let failedAt: TlsResult["failedAt"] = "connect";
  const result: { -readonly [K in keyof TlsResult]: TlsResult[K] } = {};
  let socket: NodeNet.Socket | undefined;
  try {
    let started = Date.now();
    socket =
      "proxyUrl" in target
        ? await connectThroughProxy(target.proxyUrl, host, port)
        : await connectSocket(target.address, port, target.family);
    result.connectMs = Date.now() - started;
    if ("address" in target) result.address = target.address;
    failedAt = "tls";
    started = Date.now();
    const tls = await handshake(socket, host);
    socket = tls;
    result.tlsMs = Date.now() - started;
    const leaf = tls.getPeerCertificate(true);
    result.trusted = tls.authorized;
    if (!tls.authorized) result.trustError = String(tls.authorizationError);
    result.chain = describeChain(leaf);
    const intercepted = interceptingIssuer(leaf);
    if (intercepted !== undefined) result.interceptedBy = intercepted;
    failedAt = "http";
    started = Date.now();
    const response = await headRequest(tls, host);
    result.httpMs = Date.now() - started;
    result.httpStatus = response.status;
    const serverTime = response.date === undefined ? Number.NaN : Date.parse(response.date);
    if (!Number.isNaN(serverTime)) result.clockSkewMs = serverTime - Date.now();
    return result;
  } catch (error) {
    socket?.destroy();
    return {
      ...result,
      failedAt: error instanceof ProxyUnreachableError ? "proxy" : failedAt,
      error: errorText(error),
    };
  }
};

export const formatSkew = (skewMs: number) => {
  const minutes = Math.round(Math.abs(skewMs) / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} ${skewMs > 0 ? "behind" : "ahead of"} Google`;
};

/**
 * One cheap pass over the path the agent uses (through the proxy, or direct) that names a
 * cause the user can act on, or nothing when Google looks reachable.
 */
export const explainGoogleConnectivity = async (input: {
  readonly proxyUrl: string | undefined;
  readonly host?: string;
}): Promise<string | undefined> => {
  const host = input.host ?? "oauth2.googleapis.com";
  const dns = await resolveHost(host);
  const addresses = [
    ...(typeof dns.ipv4 === "string" ? [] : dns.ipv4),
    ...(typeof dns.ipv6 === "string" ? [] : dns.ipv6),
  ];
  if (addresses.length === 0) {
    return `This computer cannot look up ${host} (${dns.ipv4}). Check DNS settings, a content filter, parental controls or the hosts file.`;
  }
  const unusable = addresses.find((address) => /^(0\.0\.0\.0|127\.|::1?$)/.test(address));
  if (unusable !== undefined) {
    return `${host} resolves to ${unusable}, so something on this computer or network blocks Google. Check the hosts file, a content filter or parental controls.`;
  }
  const ipv4 = typeof dns.ipv4 === "string" ? undefined : dns.ipv4[0];
  const result = await probeTls(
    host,
    input.proxyUrl !== undefined
      ? { proxyUrl: input.proxyUrl }
      : ipv4 !== undefined
        ? { address: ipv4, family: 4 }
        : { address: addresses[0]!, family: 6 },
  );
  if (result.interceptedBy !== undefined) {
    return `HTTPS to Google is intercepted by "${result.interceptedBy}" (antivirus HTTPS scanning, a firewall or a network filter)${
      result.trusted ? "" : " and Windows does not trust its certificate"
    }. Turn off HTTPS scanning for Google or use another network.`;
  }
  if (result.clockSkewMs !== undefined && Math.abs(result.clockSkewMs) > CLOCK_SKEW_LIMIT_MS) {
    return `This computer's clock is ${formatSkew(result.clockSkewMs)}. Set the date and time automatically, then try again.`;
  }
  if (result.error === undefined) return undefined;
  switch (result.failedAt) {
    case "proxy":
      return `Harp's local network proxy for Antigravity is unreachable (${result.error}). A firewall or security program may block connections on this computer.`;
    case "connect":
      return `This computer cannot connect to ${host} on port 443 (${result.error}). A firewall, VPN or proxy may be blocking Google.`;
    case "tls":
      return `The secure connection to ${host} fails (${result.error}). A firewall, VPN or antivirus may be interfering.`;
    default:
      return `${host} does not answer over HTTPS (${result.error}). A firewall, VPN or proxy may be interfering.`;
  }
};
