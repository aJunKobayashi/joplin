import { FolderEntity, getDatabase } from './database';
import crypto from 'crypto';
import { ModelType } from './resource';

export class Folder {
  public static create(title: string, parentId: string): FolderEntity {
    const db = getDatabase();
    const now = Date.now();
    const id = crypto.randomUUID().replace(/-/g, '');

    db.prepare(
      `
      INSERT INTO folders (id, title, parent_id, created_time, updated_time)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, title, parentId, now, now);

    const folder = this.getFolderById(id);
    return folder!;
  }

  public static rename(id: string, title: string): void {
    const db = getDatabase();
    const now = Date.now();
    db.prepare('UPDATE folders SET title = ?, updated_time = ? WHERE id = ?').run(title, now, id);
  }

  public static move(id: string, newParentId: string): void {
    const db = getDatabase();
    const now = Date.now();
    db.prepare('UPDATE folders SET parent_id = ?, updated_time = ? WHERE id = ?').run(
      newParentId,
      now,
      id
    );
  }

  public static getAllFolders(): FolderEntity[] {
    const db = getDatabase();
    const folders = db
      .prepare(
        'SELECT id, title, parent_id, updated_time, created_time FROM folders ORDER BY title ASC'
      )
      .all() as FolderEntity[];
    return folders;
  }

  public static getFolderById(id: string): FolderEntity | null {
    const db = getDatabase();
    const folder = db
      .prepare('SELECT id, title, parent_id, updated_time, created_time FROM folders WHERE id = ?')
      .get(id) as FolderEntity | undefined;
    return folder || null;
  }

  public static getSubFolderIds(parentId: string): string[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT id FROM folders WHERE parent_id = ? ORDER BY title ASC')
      .all(parentId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * フォルダ・配下のサブフォルダ・ノートを再帰的に削除する。
   * deleted_items にも同期ターゲットごとのエントリを挿入する。
   * 全操作は外部から渡されたトランザクション内で実行される。
   */
  private static deleteRecursiveInTx(folderId: string): void {
    const db = getDatabase();
    const now = Date.now();

    const insertDeleted = db.prepare(
      'INSERT INTO deleted_items (item_type, item_id, deleted_time, sync_target) VALUES (?, ?, ?, ?)'
    );

    // ── ノートを削除 ──────────────────────────────────────────────
    const noteIds = (
      db.prepare('SELECT id FROM notes WHERE parent_id = ?').all(folderId) as { id: string }[]
    ).map((r) => r.id);

    for (const noteId of noteIds) {
      const syncTargets = db
        .prepare('SELECT DISTINCT sync_target FROM sync_items WHERE item_id = ?')
        .all(noteId) as { sync_target: number }[];
      for (const t of syncTargets) {
        insertDeleted.run(ModelType.Note, noteId, now, t.sync_target);
      }
      db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
      db.prepare('DELETE FROM notes_normalized WHERE id = ?').run(noteId);
      db.prepare('DELETE FROM markdown_notes_normalized WHERE id = ?').run(noteId);
      db.prepare('DELETE FROM markdown_notes WHERE id = ?').run(noteId);
      db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    }

    // ── サブフォルダを再帰削除 ────────────────────────────────────
    const subIds = (
      db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId) as { id: string }[]
    ).map((r) => r.id);

    for (const subId of subIds) {
      this.deleteRecursiveInTx(subId);
    }

    // ── フォルダ自身を削除 ────────────────────────────────────────
    const syncTargets = db
      .prepare('SELECT DISTINCT sync_target FROM sync_items WHERE item_id = ?')
      .all(folderId) as { sync_target: number }[];
    for (const t of syncTargets) {
      insertDeleted.run(ModelType.Folder, folderId, now, t.sync_target);
    }
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  }

  public static delete(folderId: string): void {
    const db = getDatabase();
    db.transaction(() => {
      this.deleteRecursiveInTx(folderId);
    })();
  }
}
