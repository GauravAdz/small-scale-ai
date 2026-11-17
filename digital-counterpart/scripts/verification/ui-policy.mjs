export function isLoopback(url) {
  const parsed = new URL(url);
  return ["http:", "https:"].includes(parsed.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
}

export function uiRequestAllowed(url, baseURL) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname).replaceAll("\\", "/");
  return isLoopback(url) && parsed.origin === new URL(baseURL).origin && !/^\/api(?:\/|$)/i.test(pathname);
}
