const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 20;
const MAX_MESSAGE_BYTES = 200 * 1024 * 1024;

export function imagePromptParts(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES)
    throw new TypeError(`Choose at most ${MAX_IMAGES} images.`);
  let bytes = 0;
  return images.map((image) => {
    if (!image || !IMAGE_MEDIA_TYPES.has(image.mediaType) || typeof image.data !== "string")
      throw new TypeError("Only PNG, JPEG, WebP and GIF images are supported.");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data))
      throw new TypeError("Image data must be base64 encoded.");
    const length = (image.data.length * 3) / 4 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    if (length < 1 || length > MAX_IMAGE_BYTES)
      throw new TypeError("Each image must be no larger than 20 MiB.");
    bytes += length;
    if (bytes > MAX_MESSAGE_BYTES) throw new TypeError("Images exceed the 200 MiB message limit.");
    const name = typeof image.name === "string" ? image.name.replaceAll(/[\\/\x00-\x1f]/g, "").slice(0, 200) : undefined;
    return { type: "image", mediaType: image.mediaType, data: image.data, ...(name ? { name } : {}) };
  });
}
