import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = process.cwd();
const source = path.join(root, 'public', 'aifisher-logo.png');
const target = path.join(root, 'public', 'aifisher-app.ico');
// Windows picks the first ICO entry for the window, tray and taskbar: keep it high resolution.
const sizes = [256, 64, 48, 40, 32, 24, 20, 16];
const appIconBackground = '#050505';
const sourceBuffer = await readFile(source);
const images = await Promise.all(
  sizes.map((size) =>
    sharp(sourceBuffer)
      .resize(size, size, { fit: 'contain' })
      .flatten({ background: appIconBackground })
      .png()
      .toBuffer(),
  ),
);

const directorySize = 6 + images.length * 16;
let imageOffset = directorySize;
const header = Buffer.alloc(directorySize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  const size = sizes[index];
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(imageOffset, entry + 12);
  imageOffset += image.length;
});

const icon = Buffer.concat([header, ...images]);
await writeFile(target, icon);
process.stdout.write(`${target}\n`);
