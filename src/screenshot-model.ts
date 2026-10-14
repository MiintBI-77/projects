import { z } from "zod";

export const SCREENSHOT_BYTES = 256 * 1024;
export const SCREENSHOTS_PER_MESSAGE = 4;
export const SCREENSHOTS_PER_CONVERSATION = 12;
export const MESSAGE_REQUEST_BYTES = 1_500_000;
export const screenshotInputSchema = z
  .object({
    id: z.uuid(),
    mime: z.enum(["image/png", "image/jpeg"]),
    data: z
      .string()
      .min(4)
      .max(Math.ceil(SCREENSHOT_BYTES / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export const screenshotInputsSchema = z
  .array(screenshotInputSchema)
  .max(SCREENSHOTS_PER_MESSAGE)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
  );
export type ScreenshotInput = z.infer<typeof screenshotInputSchema>;
export type Screenshot = {
  id: string;
  mime: ScreenshotInput["mime"];
  bytes: number;
  width: number;
  height: number;
  sha256: string;
};

// Bound decoded dimensions as well as transport bytes. SVG/HTML are never
// accepted, even when the sender supplies an image MIME type.
export function screenshotDimensions(
  bytes: Uint8Array,
  mime: Screenshot["mime"],
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    mime === "image/png" &&
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (
    mime === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  ) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_000_000
  )
    throw Error("Choose a valid PNG or JPEG screenshot.");
  return { width, height };
}
export async function decodeScreenshots(input: ScreenshotInput[] = []) {
  const images = screenshotInputsSchema.parse(input);
  return Promise.all(
    images.map(async (image) => {
      const binary = atob(image.data);
      if (binary.length > SCREENSHOT_BYTES)
        throw Error("Screenshot is too large.");
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const dimensions = screenshotDimensions(bytes, image.mime);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const metadata: Screenshot = {
        id: image.id,
        mime: image.mime,
        bytes: bytes.length,
        ...dimensions,
        sha256: Array.from(hash, (value) =>
          value.toString(16).padStart(2, "0"),
        ).join(""),
      };
      return { metadata, bytes: bytes.buffer };
    }),
  );
}
