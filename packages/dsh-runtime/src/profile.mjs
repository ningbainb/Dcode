import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
export const PROFILE_NAME = 'dcode';

// The official bundle resolver owns the runtime dependency graph. Only the Coding
// base and its public session/model gateway are composed; no Desktop plugin suite.
export async function ensureDcodeProfile(dshHome) {
  const profileDir = join(dshHome, 'profiles', PROFILE_NAME);
  await mkdir(profileDir, { recursive: true });
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const dependencies = Object.fromEntries(bundles.map(name => [
    name, `file:${dirname(require.resolve(`${name}/package.json`)).replaceAll('\\', '/')}`,
  ]));
  const manifest = {
    name: 'dcode-runtime-profile', private: true, type: 'module',
    dependencies, dsh: { profile: { bundles } },
  };
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2));
  await mkdir(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true });
  const { symlink, lstat } = await import('node:fs/promises');
  for (const name of bundles) {
    const target = dirname(require.resolve(`${name}/package.json`));
    const link = join(profileDir, 'node_modules', ...name.split('/'));
    try { await lstat(link); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  for (const file of ['cordis.yml', 'cordis.patch.yml']) {
    const path = join(profileDir, file);
    try { await readFile(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(path, '[]\n');
    }
  }
  return { profileDir, cliPath: require.resolve('@deepseek-ai/dsh/lib/bin.js') };
}
