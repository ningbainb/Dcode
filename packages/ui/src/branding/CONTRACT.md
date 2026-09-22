# Dcode visible identity and upstream entrypoint removal

Use the user-supplied September 22 D/whale artwork as the only application logo.
Generate platform icon formats from that artwork without redesigning it. Visible product
names (startup, navigation, dialogs, menus, notifications and installers) are Dcode.
Internal package names, IPC/storage keys and compatibility identifiers stay stable;
third-party copyright and license attribution remain accurate.

Remove upstream product website, documentation, feedback, community, account/purchase,
changelog and download/update entrypoints from visible UI and native menus. Disable their
command paths and upstream automatic updater so hidden commands cannot open them.
Retain user-requested project links, GitHub backup authentication and independent provider
configuration. Do not rename identifiers or strip third-party licenses to satisfy a visual audit.

UI entry visibility follows the existing navigation/command owner. External navigation is
checked at the desktop boundary; the updater owns disabled update status. No new remote
state or compatibility migration is introduced.

Acceptance: audit visible literals and application logo assets, inspect startup/settings/about
and native menus in packaged Electron, test blocked upstream links versus permitted GitHub
links, check executable icon resources, run typecheck/lint/architecture checks and package
a local Windows installer. All artifacts and image conversion intermediates stay in E:/dcode.
