/** Base URL and headers for server-to-server calls to VIPScale (tools.vipscaleph.com). */
export function getToolsBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  return (
    process.env.TOOLS_VIP_URL ||
    (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com')
  ).replace(/\/+$/, '');
}

export function getToolsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.VIPSCALE_API_KEY || '',
  };
}
