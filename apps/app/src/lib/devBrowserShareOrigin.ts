import { Platform } from 'react-native';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const PRIVATE_IPV4_PATTERN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const DEV_SERVER_PORT = '8081';

export function redirectAndroidDevBrowserToLocalhost(): boolean {
  if (
    Platform.OS !== 'web' ||
    typeof window === 'undefined' ||
    typeof __DEV__ === 'undefined' ||
    !__DEV__
  ) {
    return false;
  }

  const { protocol, hostname, port, pathname, search, hash } = window.location;
  if (
    protocol !== 'http:' ||
    LOOPBACK_HOSTS.has(hostname) ||
    port !== DEV_SERVER_PORT ||
    !PRIVATE_IPV4_PATTERN.test(hostname)
  ) {
    return false;
  }

  const userAgent = window.navigator.userAgent || '';
  if (!/\bAndroid\b/i.test(userAgent)) {
    return false;
  }

  const targetUrl = `http://localhost:${port}${pathname}${search}${hash}`;
  if (window.location.href === targetUrl) {
    return false;
  }

  window.location.replace(targetUrl);
  return true;
}
