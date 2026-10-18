import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
  if (code === 0 && args[0] === 'build' && process.platform === 'win32') {
    const releaseExe = path.resolve('src-tauri', 'target', 'release', 'qa-board.exe');
    const rootExe = path.resolve('QA-Board.exe');
    if (fs.existsSync(releaseExe)) {
      try {
        fs.copyFileSync(releaseExe, rootExe);
        console.log(`\n✅ Executável portátil copiado para: ${rootExe}`);
        console.log('   Você pode dar dois cliques diretamente em QA-Board.exe para abrir o app!');
      } catch (err) {
        console.warn(
          `\n⚠️ O executável foi gerado em ${releaseExe}, mas não pôde ser copiado para ${rootExe} (feche o QA-Board.exe se estiver aberto): ${err.message}`,
        );
      }
    }
  }
  process.exit(code ?? 0);
});
