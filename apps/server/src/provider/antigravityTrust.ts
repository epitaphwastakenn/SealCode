// @effect-diagnostics nodeBuiltinImport:off - node:tls is the only reader of the operating system's certificate store.
import * as NodeTls from "node:tls";

/** Every variable a library in the agent's bundled Python reads for its trusted roots. */
export const ANTIGRAVITY_CA_BUNDLE_VARIABLES = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "HTTPLIB2_CA_CERTS",
  "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH",
] as const;

const normalizePem = (pem: string) => `${pem.trim().replaceAll("\r\n", "\n")}\n`;

export function mergeCaCertificates(...lists: ReadonlyArray<ReadonlyArray<string>>): string {
  return [...new Set(lists.flat().map(normalizePem))].join("");
}

const caCertificates = (type: "system" | "extra"): ReadonlyArray<string> => {
  try {
    // Node reads these once per process and caches them.
    return NodeTls.getCACertificates(type);
  } catch {
    return [];
  }
};

export const systemCaCertificates = () => caCertificates("system");

/**
 * Mozilla's roots, so it never trusts less than the agent's own certifi copy, plus the OS
 * store, where antivirus HTTPS scanning and network filters add their root, and
 * NODE_EXTRA_CA_CERTS. Browsers and curl trust the OS store; the agent's bundled Python does not.
 */
export function trustedCaCertificates(): ReadonlyArray<string> {
  return [...NodeTls.rootCertificates, ...systemCaCertificates(), ...caCertificates("extra")];
}
