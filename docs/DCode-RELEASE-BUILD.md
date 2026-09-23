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
Development builds retain their own environment. Acceptance is a clean `pack:dcode`
without caller-provided `ZCODE_ENV`: the unpacked application displays “Check for
updates”, `app-update.yml` targets `ningbainb/Dcode`, and a packaged smoke test
passes. The true older-version-to-newer-version update path still needs a live
GitHub release test; local metadata consistency alone cannot prove download and
installation. For v0.2.5, an isolated v0.2.4 application discovered the release,
downloaded an installer with the published SHA-256, and reached restart-to-update.
The installer was not run, so the final replacement/restart path remains unverified.
