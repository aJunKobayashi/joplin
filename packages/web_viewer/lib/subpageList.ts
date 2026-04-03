import * as cheerio from 'cheerio';
import { Note } from './note';
import { Folder } from './folder';

enum PageType {
  Folder,
  Note,
}

interface SubpageList {
  type: PageType;
  title: string;
  id: string;
  children: SubpageList[];
}

function createSubPageList(noteId: string): SubpageList {
  const note = Note.getNoteById(noteId);
  if (!note) {
    return { type: PageType.Folder, title: '', id: '', children: [] };
  }
  const parentFolderId = note.parent_id;
  const folder = Folder.getFolderById(parentFolderId);
  if (!folder) {
    return { type: PageType.Folder, title: '', id: '', children: [] };
  }
  const subpageList: SubpageList = {
    type: PageType.Folder,
    title: folder.title,
    id: folder.id,
    children: [],
  };
  buildSubPageList(subpageList);
  return subpageList;
}

function buildSubPageList(subpageList: SubpageList): void {
  if (subpageList.type === PageType.Note) {
    return;
  }
  const parentId = subpageList.id;

  // Add notes
  const notes = Note.getNotesByParentId(parentId);
  for (const note of notes) {
    subpageList.children.push({
      type: PageType.Note,
      title: note.title,
      id: note.id,
      children: [],
    });
  }

  // Sort notes alphabetically
  subpageList.children.sort((a, b) => {
    const nameA = a.title.toUpperCase();
    const nameB = b.title.toUpperCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  // Add subfolders
  const folderIds = Folder.getSubFolderIds(parentId);
  for (const folderId of folderIds) {
    const folder = Folder.getFolderById(folderId);
    if (!folder) continue;
    const folderPage: SubpageList = {
      type: PageType.Folder,
      title: folder.title,
      id: folder.id,
      children: [],
    };
    buildSubPageList(folderPage);
    subpageList.children.push(folderPage);
  }
}

function convertSubpageListToHTML(subpageList: SubpageList, parent: cheerio.Cheerio): void {
  if (subpageList.type === PageType.Note) {
    const li = cheerio.load(
      `<li><a href="joplin://${subpageList.id}">${subpageList.title}</a></li>`
    );
    li('li').appendTo(parent);
    return;
  }

  if (subpageList.type !== PageType.Folder) {
    return;
  }

  const litemp = cheerio.load(`<li>${subpageList.title}</li>`);
  const li = litemp('li');
  const ultemp = cheerio.load('<ul></ul>');
  const ul = ultemp('ul');

  for (const child of subpageList.children) {
    convertSubpageListToHTML(child, ul);
  }

  ul.appendTo(li);
  li.appendTo(parent);
}

export function updateSubpageLists($: cheerio.Root, noteId: string): cheerio.Root {
  const root = $('#joplin_subpagelist');
  if (root.length <= 0) {
    return $;
  }
  root.find('*').remove();
  const subpageList = createSubPageList(noteId);
  convertSubpageListToHTML(subpageList, root);
  return $;
}
