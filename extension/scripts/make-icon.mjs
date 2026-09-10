/* Generate icon.png (128x128) for the Marketplace listing. */
import { fileURLToPath } from "url";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="#b4552d"/>
  <text x="64" y="94" font-size="82" text-anchor="middle"
        fill="#fbf7ee" font-family="Georgia, 'Times New Roman', serif">C</text>
</svg>`;

const out = fileURLToPath(new URL("../icon.png", import.meta.url));
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
