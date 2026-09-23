# Dcode model provider settings on DSH

## Product behavior

The Model Providers page keeps the compact ZCode settings layout: provider list on the left, selected provider details and model list on the right, and an add-provider catalog. It must not show ZCode account, Z.ai/BigModel subscription, Start Plan or ZCode-specific provider entries. DSH is the only owner of saved provider configuration and model availability. Existing ZCode provider settings remain untouched.

The page reads DSH's model catalog and `llm-pi-ai` settings view. Its add catalog adapts ZCode's checked-in independent API templates and model IDs, including regional Alibaba Cloud and OpenCode variants, while excluding Z.ai/BigModel plans and duplicate native DeepSeek. ZCode's registry is a build-time source for choices, never a second configuration owner. Protocol names are mapped to DSH's three supported APIs. Templates are editable starting points; users can change endpoint, protocol, model IDs and capacity before saving. Model choices populate a single draft row on selection, not every model in the provider, so the user explicitly chooses what to enable. Credentials remain in DSH's credential store and are never returned to the renderer. A saved provider can be edited, have multiple models, or be removed. A provider already owned by DSH's built-in catalog may be shown but must not be silently overwritten by template creation.

The catalog has a local search across provider names, IDs and model IDs, and groups API templates separately from custom setup. The configured-provider sidebar has a separate local filter once the list is long. Each card shows protocol and model count. The selected provider shows credential status and its model count; DSH's native DeepSeek models are visible as read-only rows. Custom provider models use individual cards with model identity, source-catalog model suggestions and token-limit controls, and can be reordered or removed before saving. The editor exposes only DSH-supported fields; ZCode-only subscription, account and unsupported model options never appear. Search, selection, card order and unsaved edits are renderer-local; saving remains one DSH provider command.

## Ownership and write sequence

Renderer owns only the unsaved draft and selection. DSH settings own provider definitions; DSH credentials own secrets. Service methods expose redacted views and typed commands. `settings/mutate` writes only the selected `providers/<id>` path with the view revision, preserving unrelated providers and rejecting stale edits. A nonempty key is written with `credentials/set`; an empty key on edit means leave the saved key unchanged. Deletion unsets only the provider's settings path. The page refreshes from DSH after every successful write and dispatches the existing model-catalog changed event.

```text
load: UI -> IDshService -> DSH settings/describe + session/modelCatalog -> redacted view
save: UI draft -> IDshService -> DSH settings/mutate(revision) -> credentials/set(if provided) -> refresh
delete: UI -> IDshService -> DSH settings/mutate(unset, revision) -> refresh
```

If settings or credential persistence fails, report the failure and keep the draft. Never claim that an unsaved or partially saved provider is ready. The secret is never logged or persisted in UI state after success. Concurrent edits fail on expected revision and require refresh. The existing DSH runtime diagnostics remain available.

## Acceptance

- Existing DSH providers and models appear after reopening settings; the old single-provider form is gone.
- Add a custom provider with multiple models, edit it, and remove it without changing another provider.
- The page has no ZCode subscription or Z.ai/BigModel account entry.
- A new provider's models appear in chat selection without restarting the app.
- Catalog search narrows templates without changing persisted settings; custom setup remains available.
- Catalog includes the independent API templates from the checked-in ZCode registry, searches model IDs, and never includes Z.ai/BigModel account or plan entries.
- Native DeepSeek model identities are visible; custom model order is retained after save and refresh.
- Missing keys, invalid URLs/model IDs, and stale revisions produce clear feedback; keys are not returned to the UI.
- Desktop UI smoke and an isolated DSH settings round-trip verify the user path.
