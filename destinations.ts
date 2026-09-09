/** Cross-plugin navigation is not exposed by toPluginPanel (own panels only). */
export function isActivityHref(value: unknown): value is string {
  if (typeof value !== "string" || !/^\/plugins\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?:\/[^/?#\\]+)*$/.test(value)) return false;
  try {
    return value.split("/").slice(4).every(part => {
      const decoded = decodeURIComponent(part);
      return decoded !== "." && decoded !== ".." && !/[/\\\u0000-\u001f]/.test(decoded);
    });
  } catch { return false; }
}

export function viewingActivity(href: string | undefined, pathname = window.location.pathname): boolean {
  return isActivityHref(href) && pathname.replace(/\/$/, "") === href.replace(/\/$/, "");
}
