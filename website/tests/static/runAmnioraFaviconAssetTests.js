#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function decodePngBuffer(buffer, label, emitAssertions = true) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(`${label} is a PNG`, buffer.subarray(0, 8).equals(pngSignature));

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }

  assert(`${label} uses 8-bit color`, bitDepth === 8, `bitDepth=${bitDepth}`);
  const bytesPerPixelByColorType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const bytesPerPixel = bytesPerPixelByColorType.get(colorType);
  assert(`${label} uses a supported PNG color type`, Boolean(bytesPerPixel), `colorType=${colorType}`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = width * bytesPerPixel;
  const rows = [];
  let cursor = 0;
  let previous = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const raw = Buffer.from(inflated.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    const row = Buffer.alloc(rowBytes);

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        if (pb <= pc) return up;
        return upLeft;
      })();
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth;
      row[x] = (raw[x] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visible = 0;
  let transparent = 0;

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const i = x * bytesPerPixel;
      const r = row[i];
      const g = colorType === 0 || colorType === 4 ? r : row[i + 1];
      const b = colorType === 0 || colorType === 4 ? r : row[i + 2];
      const alpha = colorType === 4 ? row[i + 1] : colorType === 6 ? row[i + 3] : 255;
      if (alpha <= 8) transparent += 1;
      const nonWhite = !(r > 245 && g > 245 && b > 245);
      if (alpha > 8 && nonWhite) {
        visible += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return {
    width,
    height,
    visibleRatio: visible / (width * height),
    transparentRatio: transparent / (width * height),
    bboxWidth: maxX >= minX ? maxX - minX + 1 : 0,
    bboxHeight: maxY >= minY ? maxY - minY + 1 : 0,
  };
}

function parsePng(relativePath) {
  return decodePngBuffer(read(relativePath), relativePath);
}

function parseIcoBuffer(buffer, label) {
  assert(`${label} has icon header`, buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1);
  const count = buffer.readUInt16LE(4);
  const headerAndDirectoryLength = 6 + count * 16;
  assert(`${label} has complete directory table`, buffer.length >= headerAndDirectoryLength, `length=${buffer.length} required=${headerAndDirectoryLength}`);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    const width = buffer[offset] === 0 ? 256 : buffer[offset];
    const height = buffer[offset + 1] === 0 ? 256 : buffer[offset + 1];
    const bitCount = buffer.readUInt16LE(offset + 6);
    const bytesInResource = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    assert(`${label} frame ${width}x${height} starts after directory`, imageOffset >= headerAndDirectoryLength, `offset=${imageOffset} directory=${headerAndDirectoryLength}`);
    assert(`${label} frame ${width}x${height} has payload bytes`, bytesInResource > 0, `bytes=${bytesInResource}`);
    assert(
      `${label} frame ${width}x${height} payload stays inside file`,
      imageOffset + bytesInResource <= buffer.length,
      `offset=${imageOffset} bytes=${bytesInResource} file=${buffer.length}`
    );
    const payload = buffer.subarray(imageOffset, imageOffset + bytesInResource);
    const isPng = payload.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isDib = payload.length >= 40 && payload.readUInt32LE(0) >= 40;
    assert(`${label} frame ${width}x${height} has PNG or DIB bitmap signature`, isPng || isDib);
    let decoded;
    if (isPng) {
      decoded = decodePngBuffer(payload, `${label} embedded ${width}x${height}`);
      assert(`${label} embedded PNG dimensions match directory`, decoded.width === width && decoded.height === height, JSON.stringify(decoded));
    } else {
      const dibWidth = payload.readInt32LE(4);
      const dibHeight = Math.abs(payload.readInt32LE(8) / 2);
      assert(`${label} embedded DIB dimensions match directory`, dibWidth === width && dibHeight === height, `dib=${dibWidth}x${dibHeight}`);
      decoded = { width, height, visibleRatio: 1, transparentRatio: 0, bboxWidth: width, bboxHeight: height };
    }
    assert(`${label} frame ${width}x${height} is not empty`, decoded.visibleRatio > 0, JSON.stringify(decoded));
    assert(`${label} frame ${width}x${height} visible mark fills the frame`, decoded.bboxWidth / width >= 0.5 && decoded.bboxHeight / height >= 0.5, JSON.stringify(decoded));
    entries.push({ width, height, bitCount, bytesInResource, imageOffset, decoded });
  }

  const maxEnd = Math.max(...entries.map((entry) => entry.imageOffset + entry.bytesInResource));
  assert(`${label} file size is consistent with embedded payloads`, maxEnd === buffer.length, `maxEnd=${maxEnd} file=${buffer.length}`);
  return entries;
}

function parseIco(relativePath) {
  return parseIcoBuffer(read(relativePath), relativePath);
}

function assertThrows(name, fn, pattern) {
  assertions += 1;
  try {
    fn();
  } catch (error) {
    if (!pattern || pattern.test(String(error && error.message))) {
      console.log(`PASS ${name}`);
      return;
    }
    throw error;
  }
  throw new Error(`${name}: expected rejection`);
}

const expectedPngs = [
  ["public/favicon-16x16.png", 16, 0.5, 0.16, true],
  ["public/favicon-32x32.png", 32, 0.65, 0.16, true],
  ["public/favicon-48x48.png", 48, 0.7, 0.14, true],
  ["public/apple-touch-icon.png", 180, 0.7, 0.1, false],
  ["public/icons/pwa-192x192.png", 192, 0.7, 0.1, false],
  ["public/icons/pwa-512x512.png", 512, 0.7, 0.1, false],
  ["public/icons/pwa-maskable-512x512.png", 512, 0.55, 0.06, false],
];

for (const [file, size, minCoverage, minVisibleRatio, requiresTransparency] of expectedPngs) {
  const png = parsePng(file);
  assert(`${file} has expected dimensions`, png.width === size && png.height === size, JSON.stringify(png));
  assert(`${file} visible mark fills the icon`, png.bboxWidth / size >= minCoverage && png.bboxHeight / size >= minCoverage, JSON.stringify(png));
  assert(`${file} visible mark is not a tiny dot`, png.visibleRatio >= minVisibleRatio, JSON.stringify(png));
  if (requiresTransparency) {
    assert(`${file} keeps favicon transparency`, png.transparentRatio > 0.15, JSON.stringify(png));
  }
}

const icoEntries = parseIco("public/favicon.ico");
const icoSizes = icoEntries.map((entry) => `${entry.width}x${entry.height}`);
for (const size of ["16x16", "32x32", "48x48"]) {
  assert(`favicon.ico contains ${size}`, icoSizes.includes(size), icoSizes.join(", "));
}
const headerOnlyIco = Buffer.alloc(57);
headerOnlyIco.writeUInt16LE(0, 0);
headerOnlyIco.writeUInt16LE(1, 2);
headerOnlyIco.writeUInt16LE(3, 4);
[
  [16, 472, 54],
  [32, 1129, 526],
  [48, 1772, 1655],
].forEach(([size, bytes, imageOffset], index) => {
  const offset = 6 + index * 16;
  headerOnlyIco.writeUInt8(size, offset);
  headerOnlyIco.writeUInt8(size, offset + 1);
  headerOnlyIco.writeUInt16LE(1, offset + 4);
  headerOnlyIco.writeUInt16LE(32, offset + 6);
  headerOnlyIco.writeUInt32LE(bytes, offset + 8);
  headerOnlyIco.writeUInt32LE(imageOffset, offset + 12);
});
assertThrows(
  "header-only favicon.ico fixture is rejected",
  () => parseIcoBuffer(headerOnlyIco, "header-only fixture"),
  /payload stays inside file/
);

const layout = readText("app/layout.tsx");
const manifestRoute = readText("app/manifest.ts");
const staticManifest = readText("public/site.webmanifest");
const betaBanner = readText("components/layout/DevelopmentBanner.tsx");
assert("layout advertises PNG favicons before ICO fallback", layout.indexOf("/favicon-16x16.png?v=20260731-2") < layout.indexOf("/favicon.ico?v=20260731-2"));
assert("layout advertises cache-busted favicon assets", layout.includes("/favicon.ico?v=20260731-2") && layout.includes("/favicon-48x48.png?v=20260731-2"));
assert("layout declares raster ICO sizes instead of any", layout.includes('sizes: "16x16 32x32 48x48"') && !layout.includes('sizes: "any"'));
assert("layout advertises apple touch icon", layout.includes("/apple-touch-icon.png?v=20260731-2"));
assert("manifest route advertises canonical PWA icons", manifestRoute.includes("/icons/pwa-192x192.png") && manifestRoute.includes("/icons/pwa-512x512.png"));
assert("static webmanifest advertises canonical PWA icons", staticManifest.includes("/icons/pwa-192x192.png") && !staticManifest.includes("/icons/pwa-icon-192x192.png"));
assert("favicon metadata has no CyberLab icon references", !/cyberlab/i.test(layout + manifestRoute + staticManifest));
assert("no app/favicon.ico metadata override exists", !fs.existsSync(path.join(ROOT, "app", "favicon.ico")));
assert("existing private beta banner uses requested permanent copy", betaBanner.includes("Private Beta \u2014") && betaBanner.includes("Amniora is currently under active development."));
assert("existing private beta banner warns data may be reset or deleted", betaBanner.includes("information or saved data may be reset or deleted without notice."));
assert("existing private beta banner forbids sensitive production information", betaBanner.includes("Do not enter sensitive, confidential, or production information."));
assert("private beta banner remains compact single notice", (betaBanner.match(/aria-label=\"Private beta notice\"/g) || []).length === 1);
assert("private beta banner does not promise data preservation", !/guarantee|preserv|backup/i.test(betaBanner));

console.log(JSON.stringify({
  passed: true,
  assertions,
  icoFileSize: read("public/favicon.ico").length,
  icoFrames: icoEntries.map((entry) => ({
    width: entry.width,
    height: entry.height,
    imageOffset: entry.imageOffset,
    bytesInResource: entry.bytesInResource,
    visibleRatio: Number(entry.decoded.visibleRatio.toFixed(4)),
  })),
}, null, 2));
