import { runCommand } from "../../../scripts/spawn-command.mjs";
import { fileURLToPath } from "node:url";

// Dcode 安装包不能复用上一次 Preview 的 out：菜单和更新入口在构建时按产品身份编译。
runCommand("pnpm", ["run", "build:no-runtime-assets"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    ZCODE_ENV: "production",
    ZCODE_PREVIEW_IDENTITY: "0",
  },
});
