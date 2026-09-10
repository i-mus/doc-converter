import { PDFDocument } from "pdf-lib";

export interface ImageInput {
  name: string;
  data: Uint8Array;
}

const isPng = (d: Uint8Array) =>
  d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;

const isJpg = (d: Uint8Array) =>
  d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;

/**
 * Combine images into a single PDF, one page per image sized to the image.
 * Supports PNG and JPEG (detected by signature, not file extension).
 */
export async function imagesToPdf(images: ImageInput[]): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new Error("No images provided");
  }

  const pdf = await PDFDocument.create();

  for (const img of images) {
    const embed = isPng(img.data)
      ? await pdf.embedPng(img.data)
      : isJpg(img.data)
        ? await pdf.embedJpg(img.data)
        : null;

    if (!embed) {
      throw new Error(`Unsupported image (only PNG and JPEG): ${img.name}`);
    }

    const page = pdf.addPage([embed.width, embed.height]);
    page.drawImage(embed, {
      x: 0,
      y: 0,
      width: embed.width,
      height: embed.height,
    });
  }

  return pdf.save();
}
