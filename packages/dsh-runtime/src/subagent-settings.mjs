const NAMESPACE = "subagent";

export async function listDshSubagentSettings(transport) {
  const description = await transport.call("settings/describe");
  const view = description.namespaces.find((item) => item.ns === NAMESPACE);
  if (!view) throw new Error("DSH subagent settings are unavailable.");
  const maxDepth = view.value?.maxDepth;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
    throw new Error("DSH returned an invalid subagent depth.");
  return {
    maxDepth,
    revision: view.revision,
    writable: description.writable === true,
  };
}

export async function updateDshSubagentSettings(transport, maxDepth, expectedRevision) {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
    throw new Error("Subagent depth must be a non-negative integer.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("Refresh DSH subagent settings before saving.");
  const current = await listDshSubagentSettings(transport);
  if (!current.writable) throw new Error("DSH subagent settings are read-only.");
  if (current.revision !== expectedRevision)
    throw new Error("Subagent settings changed. Refresh and retry.");
  await transport.call("settings/update", {
    ns: NAMESPACE,
    patch: { maxDepth },
    expectedRevision,
  });
  return listDshSubagentSettings(transport);
}
