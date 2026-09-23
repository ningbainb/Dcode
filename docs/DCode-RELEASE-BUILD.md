# Dcode Windows release build identity

The Dcode packaging script owns the production build that it packages. It sets
`ZCODE_ENV=production` and clears the Preview identity switch for the child build,
then verifies the renderer, stages the DSH runtime, and runs electron-builder.
This prevents a previously built Preview bundle from silently entering a Dcode
installer. The Dcode builder owns package metadata and GitHub release targeting;
the existing auto-updater owns update discovery, download, and install state.

```text
pack:dcode -> production desktop build -> renderer/runtime checks -> NSIS package
                 |                         |                     |
                 v                         v                     v
       update menu compiled in       bundled resources     GitHub latest.yml
```

The build must stop on a failed child build before touching the installer.
On Windows, keep `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`, the workspace and
the build temporary directory on the same volume. The v0.2.7 build failed when
Electron downloaded into a C: cache while its temporary zip was on E:; setting
`ELECTRON_CACHE=E:\dcode\.cache\electron` and
`ELECTRON_BUILDER_CACHE=E:\dcode\.cache\electron-builder` allowed the verified
build to complete. Use the repository-pinned Node 24.14.0 and pnpm 10.33.2.
Development builds retain their own environment. Acceptance is a clean `pack:dcode`
without caller-provided `ZCODE_ENV`: the unpacked application displays “Check for
updates”, `app-update.yml` targets `ningbainb/Dcode`, and a packaged smoke test
passes. The true older-version-to-newer-version update path still needs a live
GitHub release test; local metadata consistency alone cannot prove download and
installation. For v0.2.5, an isolated v0.2.4 application discovered the release,
downloaded an installer with the published SHA-256, and reached restart-to-update.
The installer was not run, so the final replacement/restart path remains unverified.
For v0.2.6, an isolated v0.2.5 application completed the real GitHub download,
reached `update-downloaded`, and matched the release SHA-256. For v0.2.7,
the same checks passed from an isolated v0.2.6 application. Neither version's
explicit installer execution and restart has been verified in an isolated system.
For v0.2.6, the package must contain DSH `0.1.7-alpha.2` and the private Windows
DSH temp directory repair. A default `workspace-write` desktop test must reproduce
the project ACL error, invoke the visible repair action and verify that a new
session can execute PowerShell without lowering DSH's permission mode. The
unpacked installer must pass the normal desktop smoke before publication.
When a previous desktop `out` directory remains, the Dcode package includes
only main/host/preload JavaScript generated after the current build metadata
timestamp. Older chunks and source maps must be excluded from app.asar even if
the build environment does not allow cleaning the old files from disk.
The desktop runtime closure must explicitly include `node-pty` when pnpm's
hoisted root has the package but the desktop package has no local link.
AfterPack must create `app.asar.unpacked` with the target Windows native
prebuild; a missing sidecar is a package failure, not an optional artifact.
When the hoisted `node-pty` package is copied into ASAR staging, include only
the target platform's `prebuilds` subtree and omit install-machine `build` and
`bin` directories. The existing native-resource policy must pass afterward.

If a full electron-builder run is interrupted after producing a verified
`win-unpacked` directory, the `--prepackaged` path skips electron-builder's
`onAfterPack` hook that normally creates `resources/app-update.yml`. Run
`node packages/desktop/scripts/prepare-dcode-prepackaged.mjs` before NSIS. It
writes the GitHub update config, adds it to the Windows install manifest,
refreshes executable resource integrity, and rechecks the renderer and physical
DSH runtime. Then run electron-builder with `--prepackaged` and verify the final
installer using `node scripts/verify-dcode-release.mjs`.
