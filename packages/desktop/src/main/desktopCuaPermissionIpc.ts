/* eslint-disable max-lines -- 权限频道注册、拖拽浮窗与前台应用返回等待共享同一 main 进程会话状态 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, nativeImage, screen } from "electron";
import { PlatformChannels, type CuaPermissionKind, type Locale } from "@zcode/shared";
import {
  cuaHelperBundleFingerprintUnchanged,
  openCuaPermissionOnboarding,
  prepareCuaHelperPermissionDrag,
} from "./cuaAccessibilitySettings.js";
import {
  createCuaPermissionDragPanel,
  createRealCuaPermissionPanelWindow,
  type CuaPermissionDragPanel,
} from "./cuaPermissionDragPanel.js";
import { createSystemSettingsWindowWatcher } from "./cuaSystemSettingsWindowWatcher.js";

const execFileAsync = promisify(execFile);
const MACOS_SYSTEM_SETTINGS_BUNDLE_ID = "com.apple.systempreferences";
// 1x1 透明 PNG。startDrag 在 macOS 上要求 icon 非空（electron.d.ts: "The image must be non-empty
// on macOS"），连随包 ZCode 图标都读不到时用它兜底 —— 否则 startDrag 抛异常，用户完全拖不动。
const CUA_HELPER_DRAG_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
/** 拖拽光标与浮窗 tile 都用 64pt，避免巨大的光标贴图。 */
const CUA_DRAG_ICON_SIZE = 64;

/**
 * 拖拽光标与浮窗 tile 共用的 ZCode 图标（模块级缓存，避免每次拖拽读磁盘）。
 *
 * 不能用 `nativeImage.createFromNamedImage("NSApplicationIcon")`：那取的是**当前宿主 app** 的
 * 图标，dev 下宿主是 Electron.app，于是拖拽时显示 Electron 默认图标。
 * 改为显式读随包的 ZCode 图标（electron-builder 已把 build/icon.png 打进 resources/icon.png）。
 */
let cachedZCodeIcon: Electron.NativeImage | null = null;

function resolveZCodeIcon(): Electron.NativeImage {
  if (cachedZCodeIcon && !cachedZCodeIcon.isEmpty()) return cachedZCodeIcon;
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(import.meta.dirname, "..", "..", "build", "icon.png");
  const image = nativeImage.createFromPath(iconPath);
  cachedZCodeIcon = image.isEmpty()
    ? nativeImage.createFromDataURL(CUA_HELPER_DRAG_ICON_DATA_URL)
    : image;
  return cachedZCodeIcon;
}

interface CuaApplicationReturnOptions {
  openSettings: () => Promise<void>;
  timeoutMs: number;
  signal: AbortSignal;
  resolveFrontmostBundleId?: () => Promise<string | null>;
}

async function resolveFrontmostBundleId(): Promise<string | null> {
  const { stdout: front } = await execFileAsync("/usr/bin/lsappinfo", ["front"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const asn = front.trim();
  if (!asn) return null;
  const { stdout: info } = await execFileAsync(
    "/usr/bin/lsappinfo",
    ["info", "-only", "bundleid", asn],
    { encoding: "utf8", timeout: 2_000 },
  );
  return info.match(/"CFBundleIdentifier"="([^"]+)"/)?.[1] ?? null;
}

/**
 * 监听 Electron main 的应用级窗口信号，而不是 origin renderer 的 DOM focus。用户从窗口 A 发起、
 * 回到窗口 B 时，也必须推进 A 的原始 IPC；监听在 openExternal 之前安装，关闭所有竞态空窗。
 */
function waitForCuaApplicationReturn({
  openSettings,
  timeoutMs,
  signal,
  resolveFrontmostBundleId: readFrontmostBundleId = resolveFrontmostBundleId,
}: CuaApplicationReturnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let settingsOpened = false;
    // LaunchServices 查询是两次子进程往返，可能已经读到 Settings 的 ASN，却在
    // ZCode focus 边沿之后才返回 bundle id。用单调序号配对“探针开始/期间 blur”与
    // 后续 focus，既不丢失真实返回，也不复活 BrowserWindow.isFocused() 的旧快照。
    let applicationEventSequence = 0;
    let latestBlurSequence = 0;
    let latestZCodeReturnSequence = 0;
    let observedSystemSettingsAfterSequence: number | null = null;
    let activeInspections = 0;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let observationTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (observationTimer) clearTimeout(observationTimer);
      if (inspectionTimer) clearTimeout(inspectionTimer);
      app.removeListener("browser-window-blur", onBlur);
      app.removeListener("browser-window-focus", onFocus);
      app.removeListener("activate", onFocus);
      app.removeListener("before-quit", onQuit);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const maybeFinishReturn = () => {
      if (
        settingsOpened &&
        observedSystemSettingsAfterSequence !== null &&
        latestZCodeReturnSequence > observedSystemSettingsAfterSequence
      )
        finish();
    };
    const scheduleInspection = () => {
      if (settled || activeInspections > 0 || observedSystemSettingsAfterSequence !== null) return;
      if (inspectionTimer) clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(inspectFrontmost, 150);
    };
    const inspectFrontmost = (forceAtEventBoundary = false) => {
      if (
        settled ||
        observedSystemSettingsAfterSequence !== null ||
        (!forceAtEventBoundary && activeInspections > 0)
      )
        return;
      if (inspectionTimer) {
        clearTimeout(inspectionTimer);
        inspectionTimer = undefined;
      }
      const inspectionStartedAtSequence = applicationEventSequence;
      // 只有在“最近一次应用事件是 blur、且尚未看到 return focus”的离开区间内启动的采样，
      // 才能为本次 System Settings round-trip 建立证据。由 return focus 自己触发的查询即使稍后
      // 读到 LaunchServices 的滞后 Settings 值，也不能与同一 focus 配对或清除超时。
      const inspectionStartedWhileAway = latestBlurSequence > latestZCodeReturnSequence;
      activeInspections += 1;
      void readFrontmostBundleId().then(
        (bundleId) => {
          activeInspections -= 1;
          if (settled) return;
          if (
            bundleId === MACOS_SYSTEM_SETTINGS_BUNDLE_ID &&
            inspectionStartedWhileAway &&
            inspectionStartedAtSequence >= latestBlurSequence
          ) {
            // 如果本次查询期间又收到 blur，该 blur 也必须早于可接受的 ZCode
            // return edge。这会排除“先在 ZCode 内部切窗，后打开 Settings”的旧 focus。
            // LaunchServices 的结果可早于 Electron blur 投递。若 pre-open 探针先读到
            // Settings，而探测启动前恰有一次 ZCode focus/activate，立即把旧 focus 当成「返回」会误判。
            // 探针必须在最近一次 blur 后、return focus 前启动：仅检查“曾经 blur”仍会借用一次
            // 更早的内部切窗 blur；而 focus 后才启动的探针可能读到 LaunchServices 的滞后值并永久
            // 清掉超时。两类结果都忽略，交给 blur-bound/away-interval 探针确认。
            observedSystemSettingsAfterSequence = Math.max(
              inspectionStartedAtSequence,
              latestBlurSequence,
            );
            // 旧 timer 把“系统设置是否打开”的机器 SLA 错当成用户操作时限。确认设置页
            // 已在前台后立即清掉；用户停留多久都不丢 return/restart，只由显式生命周期信号结束。
            if (observationTimer) {
              clearTimeout(observationTimer);
              observationTimer = undefined;
            }
            maybeFinishReturn();
            return;
          }
          scheduleInspection();
        },
        () => {
          activeInspections -= 1;
          scheduleInspection();
        },
      );
    };
    const onBlur = () => {
      latestBlurSequence = ++applicationEventSequence;
      // pre-open 的 lsappinfo 查询可能已经采到 ZCode，却卡在第二个 info 子进程。
      // 若复用全局 single-flight，Settings 打开并快速返回的完整 round-trip 会落入盲窗。blur 边沿
      // 必须强制启动一份时间绑定的并行采样；普通 150ms 轮询仍保持 single-flight，避免无界并发。
      inspectFrontmost(true);
    };
    const onFocus = () => {
      // System Settings 成为前台后，BrowserWindow.isFocused() 仍可能短暂保留旧 true。
      // 前台探针完成时直接读取这个 stale 快照会把「刚打开设置页」误判成「用户已返回」。
      // focus/activate 总是先记序号；若对应的 Settings 探针还在飞行，它延迟返回后
      // 仍能用 inspection-start snapshot 证明这是后续边沿。边沿也可早于 openExternal resolve。
      latestZCodeReturnSequence = ++applicationEventSequence;
      inspectFrontmost();
      maybeFinishReturn();
    };
    const onQuit = () => finish(new Error("Dcode quit during CUA permission onboarding"));
    const onAbort = () =>
      finish(signal.reason ?? new Error("CUA permission onboarding origin window closed"));
    observationTimer = setTimeout(
      () =>
        finish(
          new Error(`System Settings did not return to Dcode within ${Math.max(1, timeoutMs)}ms`),
        ),
      Math.max(1, timeoutMs),
    );

    app.on("browser-window-blur", onBlur);
    app.on("browser-window-focus", onFocus);
    app.on("activate", onFocus);
    app.on("before-quit", onQuit);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    // 在调用 openExternal 前已装好所有监听；从这一刻开始轮询 LaunchServices 的真实前台 app。
    // 只有确实观察到 System Settings，后续 ZCode focus 才能推进，内部窗口切换不会误判。
    inspectFrontmost();
    void openSettings().then(
      () => {
        settingsOpened = true;
        maybeFinishReturn();
      },
      (error) => finish(error),
    );
  });
}

function normalizePermissionList(value: unknown): CuaPermissionKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<CuaPermissionKind>();
  for (const permission of value) {
    if (permission === "accessibility" || permission === "screen_recording") {
      set.add(permission);
    }
  }
  return [...set];
}

function normalizeOnboardingOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}

/**
 * 为一次 onboarding 会话建浮窗（含吸附数据源）。
 *
 * watcher 拿不到 bounds 时（二进制未随包、无 swiftc 的构建、设置页未开、进程崩溃）
 * `getSettingsBounds` 返回 null → positioner 走 fail-open 分支把面板放到屏幕底部居中。
 * 吸附是观感增强，绝不能成为授权引导的可用性前提。
 */
function createDragPanelForSession(
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  },
  getLocale: () => Locale,
): CuaPermissionDragPanel {
  const watcher = createSystemSettingsWindowWatcher({
    binaryPath: resolveWindowBoundsBinaryPath(),
    logger,
  });
  watcher.start();

  return createCuaPermissionDragPanel({
    createWindow: createRealCuaPermissionPanelWindow({
      BrowserWindow,
      app,
      preloadPath: join(import.meta.dirname, "../preload/cuaPermissionPanel.cjs"),
      rendererDir: join(import.meta.dirname, "../renderer"),
      rendererDevUrl: process.env["ELECTRON_RENDERER_URL"],
    }),
    getDisplayWorkArea: () => screen.getPrimaryDisplay().workArea,
    getSettingsBounds: () => watcher.latest(),
    stopSettingsBounds: () => watcher.stop(),
    getLocale,
    // tile 用真实 ZCode 图标，与系统设置权限列表里那一行的图标对得上，用户才能把
    // 「要拖的东西」和「要出现在列表里的条目」对应起来。
    getIconDataUrl: () =>
      resolveZCodeIcon()
        .resize({ width: CUA_DRAG_ICON_SIZE, height: CUA_DRAG_ICON_SIZE })
        .toDataURL(),
    logger,
  });
}

/** 生产走签名包内的 extraResources；dev 走 checkout 里的构建产物。 */
function resolveWindowBoundsBinaryPath(): string {
  const relative = join("macos-window-bounds", "zcode-window-bounds");
  return app.isPackaged
    ? join(process.resourcesPath, relative)
    : join(import.meta.dirname, "..", "..", "resources", relative);
}

export function registerCuaPermissionIpcHandlers(options: {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  currentApplicationLocale: () => Locale;
}) {
  // operationId 只在同一个 webContents id 命名空间内有效，避免另一个 renderer 猜中 id 后取消
  // 不属于自己的 participant。invoke 终态一定删除；destroyed 仍由原有 signal 路径兜底。
  const onboardingControllers = new Map<string, AbortController>();
  const operationKey = (senderId: number, operationId: string) => `${senderId}\0${operationId}`;

  // 已验证的 Helper.app 路径 + 字节指纹缓存。原生文件拖拽必须在 dragstart 事件链路里*同步*调用
  // event.sender.startDrag()，不能等 install/verify 这类异步 I/O（否则错过 OS 拖拽手势窗口，用户
  // 拖不出任何文件）。所以浮窗挂载时先 prepare 预热，dragstart 只读缓存 + 微秒级同步指纹比对。
  let verifiedHelperAppPath: string | null = null;
  let verifiedHelperFingerprint: string | null = null;
  // Helper 的 bundle display name。浮窗 tile 显示它而不是硬编码字符串 —— macOS 权限列表里
  // 那一行的名字就是这个值（dev 下带 Dev 后缀），两边一致用户才能确认「拖进去的就是它」。
  let verifiedHelperDisplayName: string | null = null;
  // 当前会话的浮窗。拖拽落地后要通知它冻结位置，而 StartDrag 与 onboarding 是两个独立
  // handler，故提到这一层共享；会话终态置回 null。
  let activeDragPanel: CuaPermissionDragPanel | null = null;

  function cacheVerifiedHelper(
    helperAppPath: string,
    verifiedFingerprint: string,
    displayName: string | null,
  ): void {
    verifiedHelperAppPath = helperAppPath;
    verifiedHelperFingerprint = verifiedFingerprint;
    verifiedHelperDisplayName = displayName;
  }

  function clearVerifiedHelper(): void {
    verifiedHelperAppPath = null;
    verifiedHelperFingerprint = null;
    verifiedHelperDisplayName = null;
  }

  async function refreshVerifiedHelperAppPath(): Promise<void> {
    const result = await prepareCuaHelperPermissionDrag({ logger: options.logger });
    if (result.success && result.helperAppPath && result.helperBundleFingerprint) {
      cacheVerifiedHelper(
        result.helperAppPath,
        result.helperBundleFingerprint,
        result.helperDisplayName ?? null,
      );
    } else {
      clearVerifiedHelper();
      options.logger.warn("[cua-permission-onboarding] prepare helper drag failed", result.error);
    }
  }

  // 浮窗挂载时调用：异步 install+verify 并缓存已验证路径 + 指纹，为后续同步拖拽做准备。
  ipcMain.handle(PlatformChannels.PrepareCuaHelperPermissionDrag, async () => {
    await refreshVerifiedHelperAppPath();
    // 指纹是 main 侧的同步 TOCTOU 证据，绝不跨 IPC 返回 renderer。
    return {
      success: verifiedHelperAppPath !== null,
      ...(verifiedHelperAppPath !== null ? { helperAppPath: verifiedHelperAppPath } : {}),
      ...(verifiedHelperDisplayName !== null
        ? { helperDisplayName: verifiedHelperDisplayName }
        : {}),
      ...(verifiedHelperAppPath === null ? { error: "helper drag preparation failed" } : {}),
    };
  });

  ipcMain.on(PlatformChannels.StartCuaHelperPermissionDrag, (event) => {
    const helperAppPath = verifiedHelperAppPath;
    const fingerprint = verifiedHelperFingerprint;
    if (!helperAppPath || !fingerprint) {
      // 尚未预热：这里绝不能做异步 install/verify（会错过拖拽手势）。后台补一次让下次拖拽可用，
      // 本次跳过（浮窗挂载时已触发 prepare，正常不会走到这里）。
      options.logger.warn(
        "[cua-permission-onboarding] helper drag not prepared yet; verifying in background for next drag",
      );
      void refreshVerifiedHelperAppPath();
      return;
    }
    // TOCTOU 门：prepare(验签) 之后到此刻，同 UID 攻击者可能覆写 Helper.app，而 TCC 授权绑定的正是
    // 被拖入的那个 bundle 身份。同步比对字节指纹（ino/ctime/size，ctime 用户态不可回拨）；不符即
    // 拒拖 + 清缓存重新 prepare，绝不把可能被替换的 bundle 拖进 Accessibility/Screen Recording。
    // 该比对是同步的（微秒级），不会错过拖拽手势。
    if (!cuaHelperBundleFingerprintUnchanged(helperAppPath, fingerprint)) {
      options.logger.warn(
        "[cua-permission-onboarding] cached helper changed since verification; refusing to drag a possibly-tampered bundle",
      );
      clearVerifiedHelper();
      void refreshVerifiedHelperAppPath();
      return;
    }
    const icon = resolveZCodeIcon().resize({
      width: CUA_DRAG_ICON_SIZE,
      height: CUA_DRAG_ICON_SIZE,
    });
    try {
      // 同步启动原生文件拖拽 —— 只有这样 OS 才会真的把 Helper.app 拖出到系统设置。
      event.sender.startDrag({ file: helperAppPath, icon });
    } catch (error) {
      options.logger.warn(
        "[cua-permission-onboarding] helper drag failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    // 拖拽已落地：系统设置随后会弹模态提示，继续跟踪窗口会让浮窗追着提示框跑并被压到它下面。
    activeDragPanel?.freezePosition();
    // 后续若收到 dragend/mouseup 会把浮窗直接收走（见下方 handler）；freeze 是那条信号
    // 不到时的兜底 —— 至少不让浮窗追着系统提示框跑。
    // 后台刷新缓存（Helper 可能被后台重装/升级），保证下次拖拽仍是最新的已验证路径 + 指纹。
    void refreshVerifiedHelperAppPath();
  });

  // 拖拽手势结束 —— 授权已落地，浮窗让位给设置页和系统的重启提示。用 hide 而非 destroy：
  // 下一个权限阶段还要复用同一个窗口。hide 幂等，dragend 与 mouseup 重复通知无害。
  ipcMain.on(PlatformChannels.NotifyCuaHelperPermissionDragEnded, () => {
    activeDragPanel?.hide();
  });

  ipcMain.on(PlatformChannels.CancelCuaPermissionOnboarding, (event, payload) => {
    const senderId = event.sender?.id;
    const operationId = normalizeOnboardingOperationId(
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).operationId
        : undefined,
    );
    if (!Number.isInteger(senderId) || !operationId) return;
    onboardingControllers
      .get(operationKey(senderId, operationId))
      ?.abort(new Error("CUA permission onboarding surface closed"));
  });

  ipcMain.handle(PlatformChannels.OpenCuaPermissionOnboarding, async (event, payload) => {
    // 直接打开系统设置对应面板（不再弹确认对话框 + 不再 Finder 暴露 Helper 磁贴/动画）。
    const payloadRecord =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const operationId = normalizeOnboardingOperationId(payloadRecord?.operationId);
    const requiredPermissions = normalizePermissionList(payloadRecord?.requiredPermissions);
    const originController = new AbortController();
    const sender = event.sender as {
      id?: number;
      isDestroyed?: () => boolean;
      once?: (event: "destroyed", listener: () => void) => void;
      removeListener?: (event: "destroyed", listener: () => void) => void;
    };
    const senderId =
      typeof sender.id === "number" && Number.isInteger(sender.id) ? sender.id : null;
    const participantOperationKey =
      senderId !== null && operationId ? operationKey(senderId, operationId) : null;
    if (participantOperationKey && onboardingControllers.has(participantOperationKey)) {
      return {
        success: false,
        canceled: true,
        error: "duplicate CUA permission onboarding operation id",
      };
    }
    if (participantOperationKey) {
      onboardingControllers.set(participantOperationKey, originController);
    }
    const abortForDestroyedOrigin = () =>
      originController.abort(new Error("CUA permission onboarding origin window closed"));
    if (sender.isDestroyed?.()) abortForDestroyedOrigin();
    else sender.once?.("destroyed", abortForDestroyedOrigin);

    // 惰性创建：浮窗只在 macOS 的实际引导流程里有意义，且必须逐会话新建/销毁（不做单例，
    // 避免上一会话的残留窗口被下一会话复用）。非 darwin 保持 null，全部调用点用 ?. 短路。
    //
    // 必须包 try/catch：浮窗创建要解析二进制路径、起 watcher 子进程、建 BrowserWindow，
    // 任何一步抛异常都不该击穿整个授权引导 —— 那样用户连设置页都打不开，而没有浮窗时
    // 设置页仍可用（用户能自己从 Finder 拖 .app 进列表）。降级 > 全盘失败。
    let dragPanel: CuaPermissionDragPanel | null = null;
    if (process.platform === "darwin") {
      try {
        dragPanel = createDragPanelForSession(options.logger, options.currentApplicationLocale);
      } catch (error) {
        options.logger.warn(
          "[cua-permission-onboarding] drag panel unavailable; continuing with settings pane only",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    activeDragPanel = dragPanel;

    let result: Awaited<ReturnType<typeof openCuaPermissionOnboarding>>;
    try {
      result = await openCuaPermissionOnboarding({
        initialPermission:
          payloadRecord?.initialPermission === "screen_recording"
            ? "screen_recording"
            : "accessibility",
        ...(requiredPermissions !== undefined ? { requiredPermissions } : {}),
        ...(typeof sender.id === "number" && Number.isInteger(sender.id)
          ? { participantKey: `webContents:${sender.id}` }
          : {}),
        signal: originController.signal,
        // 每个 stage：打开设置页的同时弹出拖拽浮窗（Helper 进入 TCC 列表的唯一途径），
        // 该 stage 的等待结束就收走。整个会话的终态清理在下面的 finally 里。
        openSettingsAndWaitForReturn: async (stage) => {
          try {
            await waitForCuaApplicationReturn({
              ...stage,
              openSettings: async () => {
                await stage.openSettings();
                dragPanel?.show(stage.permission);
              },
            });
          } finally {
            dragPanel?.hide();
          }
        },
        logger: options.logger,
      });
    } finally {
      // 会话终态（成功/取消/超时/origin destroyed）一律销毁浮窗。PiP 面板曾因为缺少这条
      // 无条件清理而凭空常驻，这里放在 finally 里，不依赖任何成功路径。
      dragPanel?.destroy();
      if (activeDragPanel === dragPanel) activeDragPanel = null;
      sender.removeListener?.("destroyed", abortForDestroyedOrigin);
      if (
        participantOperationKey &&
        onboardingControllers.get(participantOperationKey) === originController
      ) {
        onboardingControllers.delete(participantOperationKey);
      }
    }
    // onboarding 期间用户可能在系统设置里停留很久，不能把 stage 启动时的旧验签证据在返回后
    // 继续当作“已验证指纹”。成功后另起一次绑定 verify+fingerprint 的 prepare，供下次拖拽使用。
    if (result.success) void refreshVerifiedHelperAppPath();
    return result;
  });

  // 2026-08 审计曾把 Prepare/StartCuaHelperPermissionDrag 当作死链路删除（当时渲染层无调用方，
  // 权限引导靠 native 弹窗让 Helper 自动进入 TCC 列表）。弹窗被摘除后，拖拽成为
  // Helper 进入权限列表的唯一途径，两个频道已在上方恢复。
}
