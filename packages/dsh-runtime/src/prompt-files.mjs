const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_MESSAGE_BYTES = 50 * 1024 * 1024;

export function fileUploadRequests(files) {
  if (files == null) return [];
  if (!Array.isArray(files) || files.length > MAX_FILES)
    throw new TypeError(`Choose at most ${MAX_FILES} files.`);
  let bytes = 0;
  return files.map((file) => {
    if (!file || typeof file.data !== "string" || typeof file.name !== "string")
      throw new TypeError("Each file needs base64 data and a name.");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))
      throw new TypeError("File data must be base64 encoded.");
    const length = (file.data.length * 3) / 4 - (file.data.endsWith("==") ? 2 : file.data.endsWith("=") ? 1 : 0);
    if (length > MAX_FILE_BYTES) throw new TypeError("Each file must be no larger than 10 MiB.");
    bytes += length;
    if (bytes > MAX_MESSAGE_BYTES) throw new TypeError("Files exceed the 50 MiB message limit.");
    const name = file.name.replaceAll(/[\\/]/g, "").replaceAll(/\p{Cc}/gu, "").slice(0, 200);
    if (!name) throw new TypeError("Each file needs a name.");
    return { data: file.data, name };
  });
}
