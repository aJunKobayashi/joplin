#!/usr/bin/env tsx
/**
 * HTML エクスポート CLI エントリポイント
 *
 * 使い方:
 *   npm run export_html -- --profileName joplin-desktop --outputDir /tmp/html_export
 *   npm run export_html -- --profileName joplin-desktop --outputDir /tmp/html_export --embeded
 *
 * オプション:
 *   --profileName  ~/.config/<profileName> のプロファイル名（必須）
 *   --outputDir    HTML の出力先ディレクトリ（必須）
 *   --embeded      画像などのリソースを Base64 で HTML に埋め込む（省略時はリソースフォルダをコピー）
 */

import * as path from 'path';
import { homedir } from 'os';
import { runExportHtml } from './export_html_lib';

// ---------------------------------------------------------------------------
// 引数パース
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let profileName: string | null = null;
let outputDir: string | null = null;
let embeded = false;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];

  if (arg.startsWith('--profileName=')) {
    profileName = arg.slice('--profileName='.length);
  } else if (arg === '--profileName' && i + 1 < cliArgs.length) {
    profileName = cliArgs[i + 1];
    i++;
  }

  if (arg.startsWith('--outputDir=')) {
    outputDir = arg.slice('--outputDir='.length);
  } else if (arg === '--outputDir' && i + 1 < cliArgs.length) {
    outputDir = cliArgs[i + 1];
    i++;
  }

  if (arg === '--embeded') {
    embeded = true;
  }
}

if (!profileName || !outputDir) {
  console.error(
    'Usage: npm run export_html -- --profileName <profileName> --outputDir <outputDir> [--embeded]',
  );
  console.error('');
  console.error('Options:');
  console.error('  --profileName  Joplin profile name (e.g. joplin-desktop)');
  console.error('  --outputDir    Output directory for HTML files');
  console.error('  --embeded      Embed images as Base64 instead of copying resource folder');
  console.error('');
  console.error(
    'Example: npm run export_html -- --profileName joplin-desktop --outputDir /tmp/html_export',
  );
  process.exit(1);
}

// パストラバーサル対策
const safeProfile = path.basename(profileName);
const profileDir = path.join(homedir(), '.config', safeProfile);

// lib/database.ts の getDatabase() が ViewerUtil.getProfileFolderPath() 経由で
// PROFILE_NAME 環境変数を参照するため、エクスポート時にも設定しておく
process.env.PROFILE_NAME = safeProfile;

// outputDir を絶対パスに変換
const absoluteOutputDir = path.resolve(outputDir);

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
runExportHtml(profileDir, {
  outputDir: absoluteOutputDir,
  embededImage: embeded,
})
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Export failed:', error);
    process.exit(1);
  });
