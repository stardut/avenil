import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mark = await readFile(join(root, 'public/brand/mark.svg'), 'utf8');
const geometry = mark.replace(/<svg[^>]*>/, '').replace('</svg>', '').trim();
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>\n`;
const symbol = (transform, color) => `<g transform="${transform}" color="${color}">${geometry}</g>`;

// The icon encoder emits ICNS image entries in arbitrary order. Normalize the
// container so unchanged artwork does not produce a binary diff on every run.
function orderedIcns(data) {
  if (data.toString('ascii', 0, 4) !== 'icns' || data.readUInt32BE(4) !== data.length) {
    throw new Error('Invalid generated ICNS container');
  }
  const entries = [];
  for (let offset = 8; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error('Truncated ICNS entry');
    const length = data.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > data.length) throw new Error('Invalid ICNS entry size');
    entries.push(data.subarray(offset, offset + length));
    offset += length;
  }
  entries.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([data.subarray(0, 8), ...entries]);
}

await mkdir(join(root, 'docs/assets'), { recursive: true });
await mkdir(join(root, 'src-tauri/icons'), { recursive: true });

const icon = svg(1024, `
  <defs><linearGradient id="ground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#244d43"/><stop offset="1" stop-color="#102d28"/></linearGradient></defs>
  <rect x="80" y="80" width="864" height="864" rx="198" fill="url(#ground)"/>
  <rect x="81" y="81" width="862" height="862" rx="197" fill="none" stroke="#a9dac0" stroke-opacity=".14" stroke-width="2"/>
  ${symbol('translate(144 132) scale(11.5)', '#c7f0d8')}`);
await writeFile(join(root, 'docs/assets/app-icon.svg'), icon);
await writeFile(join(root, 'public/brand/favicon.svg'), svg(64, `<rect width="64" height="64" rx="16" fill="#183b32"/>${symbol('', '#c7f0d8')}`));

const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="480" viewBox="0 0 1440 480" fill="none">
  <title>Avenil — A quiet place for things to run.</title>
  <desc>A mint arch shelters a single point of light. A local service workspace for macOS.</desc>
  <defs><radialGradient id="light"><stop stop-color="#305b48"/><stop offset="1" stop-color="#122d27"/></radialGradient></defs>
  <rect width="1440" height="480" rx="24" fill="#122d27"/>
  <path d="M940 0h476a24 24 0 0 1 24 24v432a24 24 0 0 1-24 24H940z" fill="url(#light)"/>
  <g font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="96" y="94" fill="#a3c4b3" font-size="13" letter-spacing="3">A LOCAL SERVICE WORKSPACE</text>
    <text x="90" y="226" fill="#edf8ee" font-size="104" font-weight="600" letter-spacing="-5">Avenil</text>
    <text x="96" y="287" fill="#c7f0d8" font-size="28" letter-spacing="-.4">A quiet place for things to run.</text>
    <text x="96" y="397" fill="#a3c4b3" font-size="15" letter-spacing=".8">macOS  /  Local services  /  Open source</text>
  </g>
  ${symbol('translate(878 17) scale(6.7)', '#c7f0d8')}
</svg>\n`;
await writeFile(join(root, 'docs/assets/banner.svg'), banner);

// Tauri's installed CLI rasterizes the shared vector source. No remote assets.
const temp = await mkdtemp(join(tmpdir(), 'avenil-icons-'));
try {
  execFileSync(join(root, 'node_modules/.bin/tauri'), ['icon', join(root, 'docs/assets/app-icon.svg'), '--output', temp], { cwd: root, stdio: 'pipe' });
  await copyFile(join(temp, 'icon.png'), join(root, 'src-tauri/icons/icon.png'));
  await writeFile(join(root, 'src-tauri/icons/icon.icns'), orderedIcns(await readFile(join(temp, 'icon.icns'))));
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log('Generated Avenil banner, favicon, and macOS icons from public/brand/mark.svg.');
