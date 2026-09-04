/**
 * build.mjs — produce a release folder and a zip ready to upload.
 *
 * The build is a straight copy of the ship manifest: the game has no bundler
 * and no build step, so what is tested locally is exactly what ships. The
 * licence check runs against the built folder, not the source tree, so a stray
 * file cannot slip past it.
 *
 * Run with: node tools/build.mjs
 * Output:   dist/emoji-merge/ and dist/emoji-merge.zip
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SHIP_PATHS, isExcluded } from './ship-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'emoji-merge');
const ZIP = path.join(DIST, 'emoji-merge.zip');

async function copyInto(source, target, collected) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source)) {
      const from = path.join(source, entry);
      if (isExcluded(path.relative(ROOT, from))) continue;
      await copyInto(from, path.join(target, entry), collected);
    }
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    collected.push(target);
  }
}

// -- a minimal ZIP writer, so the build needs no dependencies ---------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

async function writeZip(entries, target) {
  const locals = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime(new Date());

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    // Store uncompressed when deflate does not help (already-compressed fonts).
    const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);

    locals.push(header, nameBytes, body);

    const dirEntry = Buffer.alloc(46);
    dirEntry.writeUInt32LE(0x02014b50, 0);
    dirEntry.writeUInt16LE(20, 4);
    dirEntry.writeUInt16LE(20, 6);
    dirEntry.writeUInt16LE(0x0800, 8);
    dirEntry.writeUInt16LE(method, 10);
    dirEntry.writeUInt16LE(stamp.time, 12);
    dirEntry.writeUInt16LE(stamp.day, 14);
    dirEntry.writeUInt32LE(crc, 16);
    dirEntry.writeUInt32LE(body.length, 20);
    dirEntry.writeUInt32LE(raw.length, 24);
    dirEntry.writeUInt16LE(nameBytes.length, 28);
    dirEntry.writeUInt32LE(0, 38);
    dirEntry.writeUInt32LE(offset, 42);
    central.push(dirEntry, nameBytes);

    offset += header.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  await fs.writeFile(target, Buffer.concat([...locals, centralBuffer, end]));
}

// -- build ------------------------------------------------------------------

console.log('Building Emoji Merge\n');

await fs.rm(OUT, { recursive: true, force: true });
await fs.rm(ZIP, { force: true });
await fs.mkdir(OUT, { recursive: true });

const copied = [];
for (const entry of SHIP_PATHS) {
  await copyInto(path.join(ROOT, entry), path.join(OUT, entry), copied);
}
console.log(`Copied ${copied.length} files into dist/emoji-merge/`);

// index.html must sit at the root of the archive, which is what portals expect.
try {
  await fs.access(path.join(OUT, 'index.html'));
} catch {
  console.error('FAIL: index.html is missing from the build.');
  process.exit(1);
}

// Audit the built folder rather than the source tree.
const audit = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'license-check.mjs'), OUT], {
  encoding: 'utf8',
});
process.stdout.write(audit.stdout ?? '');
if (audit.status !== 0) {
  process.stderr.write(audit.stderr ?? '');
  console.error('\nFAIL: the licence check did not pass. Nothing was packaged.');
  process.exit(1);
}

const entries = [];
let total = 0;
for (const file of copied.sort()) {
  const data = await fs.readFile(file);
  total += data.length;
  entries.push({ name: path.relative(OUT, file).split(path.sep).join('/'), data });
}
await writeZip(entries, ZIP);

const zipSize = (await fs.stat(ZIP)).size;
console.log(`\nUncompressed: ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log(`Archive:      dist/emoji-merge.zip (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);
console.log('\nReady to upload. index.html is at the root of the archive.');
