const IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/bmp",
  "image/tiff",
] as const;

export type ImageMime = (typeof IMAGE_MIMES)[number];

/** Screenshot bytes kept in memory for one Gemini call. Callers must not persist them. */
export interface AnalysisImage {
  mimeType: ImageMime;
  data: Buffer;
}

export function imageMime(contentType: string | undefined): ImageMime | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  if (base === "image/tif") return "image/tiff";
  return IMAGE_MIMES.find((mime) => mime === base) ?? null;
}
