#!/usr/bin/env tsx
/**
 * 使われていないリソースを特定する CLI ツール
 *
 * 使い方:
 *   npm run non_use_rsc
 *   npm run non_use_rsc -- --profileName joplin-desktop
 *
 * profileName は ~/.config/<profileName>/database.sqlite のプロファイルを指す。
 * デフォルトは環境変数 PROFILE_NAME、または "joplin_desktop"。
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// --profileName 引数をパース
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let profileName: string | null = null;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];
  if (arg.startsWith('--profileName=')) {
    profileName = arg.slice('--profileName='.length);
  } else if (arg === '--profileName' && i + 1 < cliArgs.length) {
    profileName = cliArgs[i + 1];
    i++;
  }
}

// 環境変数 PROFILE_NAME をフォールバックとして利用
profileName = profileName || process.env.PROFILE_NAME || 'joplin_desktop';

// パストラバーサルを防ぐためにサニタイズ
const safeProfile = path.basename(profileName);
const profileDir = path.join(homedir(), '.config', safeProfile);
const dbPath = path.join(profileDir, 'database.sqlite');
const resourceDir = path.join(profileDir, 'resources');

console.log(`Profile  : ${profileDir}`);
console.log(`DB       : ${dbPath}`);
console.log(`Resources: ${resourceDir}`);
console.log('');

// ---------------------------------------------------------------------------
// DB からすべてのノートの id と title を取得
// ---------------------------------------------------------------------------
interface NoteRow {
  id: string;
  title: string;
}

interface NoteBody {
  body: string;
}

const db = new Database(dbPath, { readonly: true });

const notes = db.prepare('SELECT id, title FROM notes').all() as NoteRow[];
const getBody = db.prepare('SELECT body FROM notes WHERE id = ?');

console.log(`Total notes: ${notes.length}`);

// ---------------------------------------------------------------------------
// 各ノートから参照されているリソース ID を収集
// joplin_resource://filename.ext → filename (= resource id + ext) の先頭部分が ID
// ---------------------------------------------------------------------------
const referencedIds = new Set<string>();

/** joplin_resource:// の src/href からリソース ID を抽出する */
function extractIdFromJoplinResource(value: string): string | null {
  // joplin_resource://abc123def456....jpg → "abc123def456...."
  const prefix = 'joplin_resource://';
  if (!value.startsWith(prefix)) return null;
  const filename = value.slice(prefix.length);
  // ファイル名から拡張子を除いた部分が resource id
  const id = path.basename(filename, path.extname(filename));
  return id || null;
}

for (const note of notes) {
  const row = getBody.get(note.id) as NoteBody | undefined;
  const body = row?.body;
  if (!body) continue;

  const $ = cheerio.load(body);

  // img.src, video.src, audio.src
  $('img[src], video[src], audio[src]').each((_, el) => {
    const src = (el as cheerio.TagElement).attribs.src || '';
    const id = extractIdFromJoplinResource(src);
    if (id) referencedIds.add(id);
  });

  // a.href
  $('a[href]').each((_, el) => {
    const href = (el as cheerio.TagElement).attribs.href || '';
    const id = extractIdFromJoplinResource(href);
    if (id) referencedIds.add(id);
  });
}

db.close();

console.log(`Referenced resource IDs: ${referencedIds.size}`);
console.log('');

// ---------------------------------------------------------------------------
// resources ディレクトリのファイルと照合
// ---------------------------------------------------------------------------
if (!fs.existsSync(resourceDir)) {
  console.error(`Resources directory not found: ${resourceDir}`);
  process.exit(1);
}

const resourceFiles = fs.readdirSync(resourceDir);

// resources ディレクトリにあるIDのSet
const existingIds = new Set<string>(resourceFiles.map((f) => path.basename(f, path.extname(f))));

const unusedFiles: string[] = [];

for (const filename of resourceFiles) {
  const resourceId = path.basename(filename, path.extname(filename));
  if (!referencedIds.has(resourceId)) {
    unusedFiles.push(filename);
  }
}

// HTML で参照されているがファイルが存在しないID
const missingIds: string[] = [];
for (const id of referencedIds) {
  if (!existingIds.has(id)) {
    missingIds.push(id);
  }
}

// ---------------------------------------------------------------------------
// 結果出力
// ---------------------------------------------------------------------------
console.log(`Total resource files : ${resourceFiles.length}`);
console.log(`Unused resource files: ${unusedFiles.length}`);
console.log(`Missing resource files: ${missingIds.length}`);
console.log('');

if (unusedFiles.length === 0) {
  console.log('No unused resources found.');
} else {
  console.log('--- Unused resources (in files but not referenced) ---');
  for (const filename of unusedFiles) {
    const fullPath = path.join(resourceDir, filename);
    const stat = fs.statSync(fullPath);
    const sizeKB = (stat.size / 1024).toFixed(1);
    console.log(`  ${filename}  (${sizeKB} KB)`);
  }
}

console.log('');

if (missingIds.length === 0) {
  console.log('No missing resources found.');
} else {
  console.log('--- Missing resources (referenced in notes but not in files) ---');
  for (const id of missingIds) {
    console.log(`  ${id}`);
  }
}
