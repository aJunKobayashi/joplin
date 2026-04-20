import { NoteEntity, getDatabase } from './database';
import TurndownService from 'turndown';
import { ModelType } from './resource';

export type { NoteEntity };

export interface SearchResult {
  id: string;
  title: string;
  offsets: string;
  matchinfo: Buffer | { type: 'Buffer'; data: number[] };
  user_created_time: number;
  user_updated_time: number;
  is_todo: number;
  todo_completed: number;
  parent_id: string | null;
}

export interface MarkdownSearchResult {
  id: string;
  title: string;
  offsets: string;
  parent_id: string | null;
}

export interface MarkdownNoteEntity {
  id: string;
  parent_id: string;
  title: string;
  body: string;
  created_time: number;
  updated_time: number;
}

export interface MarkdownSearchApiResult {
  results: MarkdownSearchResult[];
  noteMap: Record<string, MarkdownNoteEntity>;
}

export interface SearchApiResult {
  results: SearchResult[];
  noteMap: Record<string, NoteEntity>;
}

export class Note {
  public static getAllNotesMetadata(): NoteEntity[] {
    const db = getDatabase();
    const notes = db
      .prepare(
        'SELECT id, parent_id, title, created_time, updated_time, is_conflict, latitude, longitude, altitude, author, source_url, is_todo, todo_due, todo_completed, source, source_application, application_data, `order` FROM notes ORDER BY updated_time DESC'
      )
      .all() as NoteEntity[];
    return notes;
  }

  public static getNoteById(id: string): NoteEntity | null {
    const db = getDatabase();
    const stmt = db.prepare(
      'SELECT id, parent_id, title, created_time, updated_time, is_conflict, latitude, longitude, altitude, author, source_url, is_todo, todo_due, todo_completed, source, source_application, application_data, `order`, body FROM notes WHERE id = ?'
    );
    const note = stmt.get(id) as NoteEntity | undefined;
    return note || null;
  }

  public static getNotesByParentId(parentId: string): NoteEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT id, parent_id, title, updated_time FROM notes WHERE parent_id = ? ORDER BY title ASC'
      )
      .all(parentId) as NoteEntity[];
    return rows;
  }

  public static selectAll(matchQuery: string): SearchResult[] {
    const db = getDatabase();
    const sql = `
            SELECT
                notes_fts.id,
                notes_fts.title,
                offsets(notes_fts) AS offsets,
                matchinfo(notes_fts, 'pcnalx') AS matchinfo,
                notes_fts.user_created_time,
                notes_fts.user_updated_time,
                notes_fts.is_todo,
                notes_fts.todo_completed,
                notes_fts.parent_id
            FROM notes_fts
            WHERE 1 AND notes_fts MATCH ?`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(matchQuery);
    return rows as SearchResult[];
  }

  public static byIds(ids: string[], fields: string[] = ['*']): NoteEntity[] {
    if (!ids.length) return [];

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT ${fields.join(', ')} FROM notes WHERE id IN (${placeholders})`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...ids);
    return rows as NoteEntity[];
  }

  public static selectAllMarkdownFts(matchQuery: string): MarkdownSearchResult[] {
    return this.selectAllMarkdownFtsByMode(matchQuery, 'OR');
  }

  /**
   * AND/OR モードを指定して FTS 検索を行う
   * AND: すべてのキーワードを含むノートのみ（精度重視）
   * OR: いずれかのキーワードを含むノート（再現率重視）
   */
  public static selectAllMarkdownFtsByMode(
    matchQuery: string,
    mode: 'AND' | 'OR'
  ): MarkdownSearchResult[] {
    const db = getDatabase();

    const terms = matchQuery.split(/[\s\u3000]+/).filter(Boolean);
    const joiner = mode === 'AND' ? ' ' : ' OR ';
    const ftsQuery = terms.length > 1 ? terms.join(joiner) : terms[0] || matchQuery;

    const sql = `
            SELECT
                markdown_notes_fts.id,
                markdown_notes_fts.title,
                offsets(markdown_notes_fts) AS offsets
            FROM markdown_notes_fts
            WHERE markdown_notes_fts MATCH ?`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(ftsQuery);

    // parent_id is not in the FTS table, so we join from markdown_notes
    const ids = (rows as any[]).map((r) => r.id);
    if (ids.length === 0) return [];

    const parentMap: Record<string, string | null> = {};
    const placeholders = ids.map(() => '?').join(',');
    const parentRows = db
      .prepare(`SELECT id, parent_id FROM markdown_notes WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; parent_id: string }[];
    parentRows.forEach((r) => {
      parentMap[r.id] = r.parent_id || null;
    });

    return (rows as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      offsets: r.offsets,
      parent_id: parentMap[r.id] || null,
    }));
  }

  public static markdownByIds(ids: string[], fields: string[] = ['*']): MarkdownNoteEntity[] {
    if (!ids.length) return [];

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT ${fields.join(', ')} FROM markdown_notes WHERE id IN (${placeholders})`;

    const stmt = db.prepare(sql);
    const rows = stmt.all(...ids);
    return rows as MarkdownNoteEntity[];
  }

  /**
   * タイトルでノートを部分一致検索（LIKE）
   * 軽量なタイトルのみ検索。結果は updated_time 降順。
   */
  public static searchByTitle(query: string, maxResults: number = 10): MarkdownNoteEntity[] {
    const db = getDatabase();
    const likePattern = `%${query}%`;
    const sql = `SELECT id, parent_id, title, '' AS body, created_time, updated_time
                 FROM markdown_notes
                 WHERE title LIKE ?
                 ORDER BY updated_time DESC
                 LIMIT ?`;
    const rows = db.prepare(sql).all(likePattern, maxResults);
    return rows as MarkdownNoteEntity[];
  }

  /** テキストを正規化（ダイアクリティクス除去 + 小文字化） */
  private static normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * note を notes / notes_normalized / markdown_notes / markdown_notes_normalized の各テーブルに保存する。
   * packages/lib/models/Note.ts の save() および MarkdownNoteService.saveMarkdownNote() に相当。
   * - notes_fts        : notes_normalized への INSERT/DELETE トリガーで自動更新
   * - markdown_notes_fts: markdown_notes_normalized への INSERT/DELETE トリガーで自動更新
   */
  public static save(note: Partial<NoteEntity> & { id: string }): void {
    const db = getDatabase();
    const now = Date.now();
    const { id, ...fields } = note;

    // 1. notes テーブルを更新
    const entries = Object.entries({ ...fields, updated_time: now });
    const setClauses = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    db.prepare(`UPDATE notes SET ${setClauses} WHERE id = ?`).run(...values, id);

    // UPDATE 後の最新行を取得（notes_normalized / markdown 系テーブルで必要なフィールドを補完するため）
    const current = db
      .prepare(
        'SELECT id, parent_id, title, body, is_todo, todo_due, todo_completed, latitude, longitude, altitude, source_url, updated_time, created_time, user_created_time, user_updated_time FROM notes WHERE id = ?'
      )
      .get(id) as any;

    if (!current) return;

    // better-sqlite3 の transaction でアトミックに実行
    db.transaction(() => {
      // 2. notes_normalized を更新（SearchEngine が使う FTS 用正規化テーブル）
      //    title / body はダイアクリティクス除去 + 小文字化して格納
      //    notes_fts はトリガーにより自動更新される
      const normTitle = this.normalizeText(current.title ?? '');
      const normBody = this.normalizeText(current.body ?? '');

      db.prepare('DELETE FROM notes_normalized WHERE id = ?').run(id);
      db.prepare(`INSERT INTO notes_normalized (id, title, body) VALUES (?, ?, ?)`).run(
        id,
        normTitle,
        normBody
      );

      // 3. markdown_notes / markdown_notes_normalized を更新
      //    body が存在する場合のみ実行（markdown_notes_fts はトリガーで自動更新される）
      //    MarkdownNoteService 同様、body は HTML→Markdown 変換してから保存する
      if (current.body) {
        const mdTitle = current.title ?? '';
        const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        const mdBody = turndown.turndown(current.body);

        db.prepare('DELETE FROM markdown_notes WHERE id = ?').run(id);
        db.prepare(
          `INSERT INTO markdown_notes (id, parent_id, title, body, created_time, updated_time)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, current.parent_id ?? '', mdTitle, mdBody, now, now);

        db.prepare('DELETE FROM markdown_notes_normalized WHERE id = ?').run(id);
        db.prepare(
          `INSERT INTO markdown_notes_normalized (id, title, body)
           VALUES (?, ?, ?)`
        ).run(id, this.normalizeText(mdTitle), this.normalizeText(mdBody));
      }
    })();
  }

  public static updateNoteBody(id: string, body: string): void {
    const note = this.getNoteById(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    this.save({ ...note, body });
  }

  public static create(title: string, parentId: string): NoteEntity {
    const db = getDatabase();
    const now = Date.now();
    const id = require('crypto').randomUUID().replace(/-/g, '');

    db.prepare(
      `
      INSERT INTO notes (id, parent_id, title, body, created_time, updated_time,
        is_conflict, latitude, longitude, altitude, author, source_url,
        is_todo, todo_due, todo_completed, source, source_application, application_data, \`order\`)
      VALUES (?, ?, ?, '', ?, ?, 0, 0, 0, 0, '', '', 0, 0, 0, '', '', '', 0)
    `
    ).run(id, parentId, title, now, now);

    db.transaction(() => {
      const normTitle = this.normalizeText(title);
      db.prepare('DELETE FROM notes_normalized WHERE id = ?').run(id);
      db.prepare('INSERT INTO notes_normalized (id, title, body) VALUES (?, ?, ?)').run(
        id,
        normTitle,
        ''
      );
    })();

    const note = this.getNoteById(id);
    return note!;
  }

  public static delete(id: string): void {
    const db = getDatabase();
    const now = Date.now();

    db.transaction(() => {
      // 同期済みの各 sync_target に対して deleted_items へエントリを挿入する
      // (BaseItem.batchDelete の trackDeleted 処理に相当)
      const syncTargetRows = db
        .prepare('SELECT DISTINCT sync_target FROM sync_items WHERE item_id = ?')
        .all(id) as { sync_target: number }[];

      const insertDeleted = db.prepare(
        'INSERT INTO deleted_items (item_type, item_id, deleted_time, sync_target) VALUES (?, ?, ?, ?)'
      );
      for (const t of syncTargetRows) {
        insertDeleted.run(ModelType.Note, id, now, t.sync_target);
      }

      // note_tags を先に削除
      db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id);

      // notes_normalized を削除するとトリガー notes_fts_before_delete が発火し
      // notes_fts も自動的にクリーンアップされる
      db.prepare('DELETE FROM notes_normalized WHERE id = ?').run(id);

      // markdown_notes_normalized を削除するとトリガーが発火し
      // markdown_notes_fts も自動的にクリーンアップされる
      db.prepare('DELETE FROM markdown_notes_normalized WHERE id = ?').run(id);
      db.prepare('DELETE FROM markdown_notes WHERE id = ?').run(id);

      // 最後に notes 本体を削除
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    })();
  }
}
