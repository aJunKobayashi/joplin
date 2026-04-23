#!/usr/bin/env tsx
/**
 * コンフリクトノート検出 CLI
 *
 * 使い方:
 *   npm run check_conflict -- --profileName joplin_desktop_tips
 *
 * オプション:
 *   --profileName  ~/.config/<profileName> のプロファイル名（省略時: joplin_desktop）
 */

import * as path from 'path';
import { getDatabase, closeDatabase, NoteEntity } from '../lib/database';

// ---------------------------------------------------------------------------
// 引数パース
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

if (profileName) {
  // パストラバーサル対策
  process.env.PROFILE_NAME = path.basename(profileName);
}

const db = getDatabase();

const conflictNotes = db
  .prepare('SELECT id, title FROM notes WHERE is_conflict = 1 ORDER BY title ASC')
  .all() as Pick<NoteEntity, 'id' | 'title'>[];

closeDatabase();

if (conflictNotes.length === 0) {
  console.log('No conflict notes found.');
  process.exit(0);
}

console.error(`Found ${conflictNotes.length} conflict note(s):`);
for (const note of conflictNotes) {
  console.error(`  note_id: ${note.id}  title: ${note.title}`);
}
process.exit(1);
