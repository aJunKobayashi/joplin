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
// DB からすべてのノートの body と markup_language を取得
// ---------------------------------------------------------------------------
interface NoteRow {
  id: string;
  title: string;
  body: string;
  markup_language: number; // 1=Markdown, 2=HTML
}

const db = new Database(dbPath, { readonly: true });

const notes = db.prepare('SELECT id, title, body, markup_language FROM notes').all() as NoteRow[];

db.close();

console.log(`Total notes: ${notes.length}`);

// ---------------------------------------------------------------------------
// 各ノートから参照されているリソース ID を収集
// joplin_resource://filename.ext → filename (= resource id + ext) の先頭部分が ID
// Markdown ノートは :/resource_id パターンを使用
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
  const { body, markup_language } = note;
  if (!body) continue;

  if (markup_language === 2) {
    // --- HTML ノート: cheerio でパース ---
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
  } else {
    // --- Markdown ノート: :/resource_id パターンを regex で抽出 ---
    // Joplin Markdown では :/[a-f0-9]{32,64} がリソース参照（長さはバージョンにより異なる）
    const markdownResourceRe = /:\/([\da-f]{32,64})/gi;
    let match: RegExpExecArray | null;
    while ((match = markdownResourceRe.exec(body)) !== null) {
      referencedIds.add(match[1]);
    }

    // HTML が混在している場合 (TinyMCE 編集後の混在ノートなど) も対応
    const $ = cheerio.load(body);
    $('img[src], video[src], audio[src]').each((_, el) => {
      const src = (el as cheerio.TagElement).attribs.src || '';
      const id = extractIdFromJoplinResource(src);
      if (id) referencedIds.add(id);
    });
    $('a[href]').each((_, el) => {
      const href = (el as cheerio.TagElement).attribs.href || '';
      const id = extractIdFromJoplinResource(href);
      if (id) referencedIds.add(id);
    });
  }
}

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

const unusedFiles: string[] = [];

for (const filename of resourceFiles) {
  // resources フォルダには .crypted など拡張子のないファイルもある場合があるため、
  // ピリオドで split して最初の部分を ID とみなす
  const resourceId = path.basename(filename, path.extname(filename));
  if (!referencedIds.has(resourceId)) {
    unusedFiles.push(filename);
  }
}

// ---------------------------------------------------------------------------
// 結果出力
// ---------------------------------------------------------------------------
console.log(`Total resource files : ${resourceFiles.length}`);
console.log(`Unused resource files: ${unusedFiles.length}`);
console.log('');

if (unusedFiles.length === 0) {
  console.log('No unused resources found.');
} else {
  console.log('--- Unused resources ---');
  for (const filename of unusedFiles) {
    const fullPath = path.join(resourceDir, filename);
    const stat = fs.statSync(fullPath);
    const sizeKB = (stat.size / 1024).toFixed(1);
    console.log(`  ${filename}  (${sizeKB} KB)`);
  }
}
