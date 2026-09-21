/** Preserve the official in-process browser session while carrying narrow client cookies. */
export function mergeDesktopPipeCookies(browserCookie, sourceCookie) {
  if (typeof sourceCookie !== 'string' || sourceCookie.trim() === '') return browserCookie
  return `${browserCookie}; ${sourceCookie}`
}
