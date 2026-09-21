//#region src/workspace-file-open-policy.ts
/**
* Shared Desktop authority policy for the native workspace-file opener.
*
* The Electron main process and its always-mounted host route use this exact
* allowlist. `shell.openPath()` follows operating-system associations, so a
* denylist would leave future executable/shortcut extensions exposed.
*/
/**
* Process-private Desktop-to-Host capability transport. These identifiers are
* deliberately public constants; only the per-runtime random value is
* secret. It must never cross a renderer/preload/SDK boundary.
*/
const DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_ENV = "DSH_DESKTOP_WORKSPACE_FILE_OPEN_TOKEN";
const DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER = "x-dsh-desktop-workspace-file-open-token";
const DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_LENGTH = 43;
const DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{43}$`, "u");
/** True only for the base64url encoding of Desktop's 32-byte launch secret. */
function isDesktopWorkspaceFileOpenToken(value) {
	return typeof value === "string" && DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_PATTERN.test(value);
}
const SAFE_EXTERNAL_OPEN_EXTENSIONS = /* @__PURE__ */ new Set([
	"txt",
	"md",
	"markdown",
	"mdx",
	"rst",
	"adoc",
	"pdf",
	"rtf",
	"csv",
	"tsv",
	"json",
	"jsonc",
	"yaml",
	"yml",
	"toml",
	"xml",
	"ini",
	"conf",
	"cfg",
	"log",
	"diff",
	"patch",
	"doc",
	"docx",
	"odt",
	"xls",
	"xlsx",
	"ods",
	"ppt",
	"pptx",
	"odp",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"avif",
	"ico",
	"tif",
	"tiff",
	"heic",
	"heif",
	"mp3",
	"wav",
	"flac",
	"ogg",
	"oga",
	"opus",
	"m4a",
	"aac",
	"aif",
	"aiff",
	"mp4",
	"m4v",
	"mov",
	"webm",
	"avi",
	"mkv",
	"mpeg",
	"mpg",
	"wmv",
	"3gp",
	"3g2",
	"ts",
	"tsx",
	"jsx",
	"css",
	"scss",
	"less",
	"c",
	"h",
	"cc",
	"cpp",
	"cxx",
	"hpp",
	"java",
	"cs",
	"go",
	"rs",
	"swift",
	"kt",
	"kts",
	"scala",
	"sql",
	"graphql",
	"proto",
	"prisma",
	"vue",
	"svelte",
	"astro",
	"zig",
	"dart"
]);
const SAFE_EXTERNAL_OPEN_NAMES = /* @__PURE__ */ new Set([
	"license",
	"licence",
	"readme",
	"changelog",
	"contributing",
	"authors",
	"notice",
	"makefile",
	"dockerfile",
	"justfile",
	"gemfile",
	"rakefile",
	"procfile"
]);
function normalizedOpenBaseName(value) {
	const normalized = value.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1).replace(/[ .]+$/u, "").toLowerCase();
}
/**
* True only for a non-shell-dispatched file type allowed by Desktop's native
* opener. It rejects Windows alternate data streams as well as script,
* shortcut, executable, and URL-shaped names by construction.
*/
function isSafeDesktopWorkspaceFileOpenPath(value) {
	if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f]/u.test(value)) return false;
	const normalized = value.replaceAll("\\", "/");
	if (/^[a-z][a-z\d+.-]*:/iu.test(normalized) && !/^[a-z]:\//iu.test(normalized)) return false;
	const base = normalizedOpenBaseName(value);
	if (base.length === 0 || base.includes(":")) return false;
	if (SAFE_EXTERNAL_OPEN_NAMES.has(base)) return true;
	const dot = base.lastIndexOf(".");
	return dot > 0 && SAFE_EXTERNAL_OPEN_EXTENSIONS.has(base.slice(dot + 1));
}
//#endregion
export { DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_ENV, DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER, DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_LENGTH, isDesktopWorkspaceFileOpenToken, isSafeDesktopWorkspaceFileOpenPath };
