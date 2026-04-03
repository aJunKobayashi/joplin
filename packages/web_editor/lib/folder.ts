import { FolderEntity, getDatabase } from './database';

export class Folder {
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
}
