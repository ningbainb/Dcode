import { resolve } from "node:path";

export function resolveDcodePackagedResources(context) {
  if (context.electronPlatformName === "darwin") {
    const appName = context.packager?.appInfo?.productFilename;
    if (!appName) throw new Error("Dcode macOS package name is unavailable.");
    return resolve(context.appOutDir, `${appName}.app`, "Contents", "Resources");
  }
  if (context.electronPlatformName === "win32" || context.electronPlatformName === "linux")
    return resolve(context.appOutDir, "resources");
  throw new Error(`Unsupported Dcode package platform: ${context.electronPlatformName}`);
}
