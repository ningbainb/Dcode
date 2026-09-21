import base from './electron-builder.config.js';
import { resolve } from 'node:path';

export default {
  ...base,
  appId: 'com.dcode.desktop',
  productName: 'DCode',
  extraMetadata: { ...base.extraMetadata, name: 'dcode-desktop', version: '0.1.0' },
  directories: { ...base.directories, output: resolve(import.meta.dirname, '../../../../artifacts') },
  files: [...base.files, '!node_modules/@dcode/**', '!node_modules/@deepseek-ai/**'],
  extraResources: [
    ...base.extraResources,
    { from: 'dcode-runtime-v1', to: 'dsh-runtime', filter: ['**/*'] },
    { from: '../../LICENSE', to: 'ZCode-LICENSE' },
    { from: '../../NOTICE.DCode.md', to: 'NOTICE.DCode.md' },
  ],
  protocols: [{ name: 'DCode', schemes: ['dcode'] }],
  win: { ...base.win, target: ['zip'], artifactName: 'DCode-${version}-win-${arch}.${ext}', signAndEditExecutable: false },
  publish: null,
};
