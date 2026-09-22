/** Dcode 不提供上游产品账号、反馈、社区、文档或更新服务。 */
export const DCODE_UPSTREAM_SERVICES_ENABLED = false;

export function isDcodeBlockedUpstreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      host === "zcode.z.ai" ||
      host.endsWith(".zcode.z.ai") ||
      host === "zcode.zhipuai.cn" ||
      (host === "github.com" && /^\/zai-org\/zcode(?:\/|$)/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}
