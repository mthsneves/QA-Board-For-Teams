import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
const currentPath = process.env[pathKey] || '';

if (!currentPath.toLowerCase().includes(cargoBin.toLowerCase())) {
  process.env[pathKey] = `${cargoBin}${path.delimiter}${currentPath}`;
}

const tauriBin = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
);

const args = process.argv.slice(2);
const child = spawn(tauriBin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
