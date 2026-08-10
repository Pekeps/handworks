import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist/assets'), { recursive: true });
for (const f of ['left.glb', 'right.glb', 'NOTICE.md']) {
  cpSync(join(root, 'src/assets', f), join(root, 'dist/assets', f));
}
console.log('assets copied to dist/assets');
