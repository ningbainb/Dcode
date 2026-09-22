# Dcode model provider settings on DSH

## Product behavior

The Model Providers page keeps the compact ZCode settings layout: provider list on the left, selected provider details and model list on the right, and an add-provider catalog. It must not show ZCode account, Z.ai/BigModel subscription, Start Plan or ZCode-specific provider entries. DSH is the only owner of saved provider configuration and model availability. Existing ZCode provider settings remain untouched.

The page reads DSH's model catalog and `llm-pi-ai` settings view. It offers independent API-key templates (DeepSeek, OpenAI, Anthropic, OpenRouter, MiniMax, Moonshot, Alibaba Cloud and xAI) and a custom provider. Templates are editable starting points; users can change endpoint, protocol, model IDs and capacity before saving. Templates without a verified regional endpoint leave the URL blank for the user to enter. Credentials remain in DSH's credential store and are never returned to the renderer. A saved provider can be edited, have multiple models, or be removed. A provider already owned by DSH's built-in catalog may be shown but must not be silently overwritten by template creation.

The catalog has a local search and groups API templates separately from custom setup. The selected provider shows credential status and its model count; DSH's native DeepSeek models are visible as read-only rows. Custom provider models use individual cards with model identity and token-limit controls, and can be reordered or removed before saving. The editor exposes only DSH-supported fields; ZCode-only subscription, account and unsupported model options never appear. Search, selection, card order and unsaved edits are renderer-local; saving remains one DSH provider command.

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
- Native DeepSeek model identities are visible; custom model order is retained after save and refresh.
- Missing keys, invalid URLs/model IDs, and stale revisions produce clear feedback; keys are not returned to the UI.
- Desktop UI smoke and an isolated DSH settings round-trip verify the user path.
