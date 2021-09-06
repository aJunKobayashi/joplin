import { utils as pluginUtils, PluginStates } from '@joplin/lib/services/plugins/reducer';
import CommandService from '@joplin/lib/services/CommandService';
import SyncTargetJoplinServer from '@joplin/lib/SyncTargetJoplinServer';
import eventManager from '@joplin/lib/eventManager';
import InteropService from '@joplin/lib/services/interop/InteropService';
import MenuUtils from '@joplin/lib/services/commands/MenuUtils';
import InteropServiceHelper from '../../InteropServiceHelper';
import { _ } from '@joplin/lib/locale';
import { MenuItemLocation } from '@joplin/lib/services/plugins/api/types';

import BaseModel from '@joplin/lib/BaseModel';
const bridge = require('electron').remote.require('./bridge').default;
const Menu = bridge().Menu;
const MenuItem = bridge().MenuItem;
import Note from '@joplin/lib/models/Note';
import Folder from '@joplin/lib/models/Folder';
import Setting from '@joplin/lib/models/Setting';
import * as cheerio from 'cheerio';
const { substrWithEllipsis } = require('@joplin/lib/string-utils');

interface ContextMenuProps {
	notes: any[];
	dispatch: Function;
	watchedNoteFiles: string[];
	plugins: PluginStates;
	inConflictFolder: boolean;
}

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

export default class NoteListUtils {
	static makeContextMenu(noteIds: string[], props: ContextMenuProps) {
		const cmdService = CommandService.instance();

		const menuUtils = new MenuUtils(cmdService);

		const notes = noteIds.map(id => BaseModel.byId(props.notes, id));

		const singleNoteId = noteIds.length === 1 ? noteIds[0] : null;

		let hasEncrypted = false;
		for (let i = 0; i < notes.length; i++) {
			if (notes[i].encryption_applied) hasEncrypted = true;
		}

		const menu = new Menu();

		if (!hasEncrypted) {
			menu.append(
				new MenuItem(menuUtils.commandToStatefulMenuItem('setTags', noteIds))
			);

			menu.append(
				new MenuItem(menuUtils.commandToStatefulMenuItem('moveToFolder', noteIds))
			);

			menu.append(
				new MenuItem({
					label: _('Duplicate'),
					click: async () => {
						for (let i = 0; i < noteIds.length; i++) {
							const note = await Note.load(noteIds[i]);
							await Note.duplicate(noteIds[i], {
								uniqueTitle: _('%s - Copy', note.title),
							});
						}
					},
				})
			);

			if (singleNoteId) {
				const cmd = props.watchedNoteFiles.includes(singleNoteId) ? 'stopExternalEditing' : 'startExternalEditing';
				menu.append(new MenuItem(menuUtils.commandToStatefulMenuItem(cmd, singleNoteId)));
			}

			if (noteIds.length <= 1) {
				menu.append(
					new MenuItem({
						label: _('Switch between note and to-do type'),
						click: async () => {
							for (let i = 0; i < noteIds.length; i++) {
								const note = await Note.load(noteIds[i]);
								const newNote = await Note.save(Note.toggleIsTodo(note), { userSideValidation: true });
								const eventNote = {
									id: newNote.id,
									is_todo: newNote.is_todo,
									todo_due: newNote.todo_due,
									todo_completed: newNote.todo_completed,
								};
								eventManager.emit('noteTypeToggle', { noteId: note.id, note: eventNote });
							}
						},
					})
				);
			} else {
				const switchNoteType = async (noteIds: string[], type: string) => {
					for (let i = 0; i < noteIds.length; i++) {
						const note = await Note.load(noteIds[i]);
						const newNote = Note.changeNoteType(note, type);
						if (newNote === note) continue;
						await Note.save(newNote, { userSideValidation: true });
						eventManager.emit('noteTypeToggle', { noteId: note.id });
					}
				};

				menu.append(
					new MenuItem({
						label: _('Switch to note type'),
						click: async () => {
							await switchNoteType(noteIds, 'note');
						},
					})
				);

				menu.append(
					new MenuItem({
						label: _('Switch to to-do type'),
						click: async () => {
							await switchNoteType(noteIds, 'todo');
						},
					})
				);
			}

			menu.append(
				new MenuItem({
					label: _('Copy Anchor link'),
					click: async () => {
						const { clipboard } = require('electron');
						const links = [];
						for (let i = 0; i < noteIds.length; i++) {
							const note = await Note.load(noteIds[i]);
							links.push(Note.copyAnchorTag(note));
						}
						clipboard.writeHTML(links.join(' '));
					},
				})
			);

			menu.append(
				new MenuItem({
					label: _('Copy Subpage List'),
					click: async () => {
						const { clipboard } = require('electron');
						const subPageLists: SubpageList[] = [];
						for (let i = 0; i < noteIds.length; i++) {
							// TODO create subpagelist.
							const subpageList = await NoteListUtils.createSubPageList(noteIds[i]);
							subPageLists.push(subpageList);
							const jsonstr = JSON.stringify(subpageList, null, ' ');
							console.log(`subpagelist: ${jsonstr}`);
						}
						const htmlStr = NoteListUtils.convertSubpageListsToHTML(subPageLists);
						clipboard.writeHTML(htmlStr);
					},
				})
			);

			menu.append(
				new MenuItem(menuUtils.commandToStatefulMenuItem('ShowBrowser', singleNoteId))
			);


			if (Setting.value('sync.target') === SyncTargetJoplinServer.id()) {
				menu.append(
					new MenuItem(
						menuUtils.commandToStatefulMenuItem('showShareNoteDialog', noteIds.slice())
					)
				);
			}

			const exportMenu = new Menu();

			const ioService = InteropService.instance();
			const ioModules = ioService.modules();
			for (let i = 0; i < ioModules.length; i++) {
				const module = ioModules[i];
				if (module.type !== 'exporter') continue;
				if (noteIds.length > 1 && module.isNoteArchive === false) continue;

				exportMenu.append(
					new MenuItem({
						label: module.fullLabel(),
						click: async () => {
							await InteropServiceHelper.export(props.dispatch.bind(this), module, {
								sourceNoteIds: noteIds,
								includeConflicts: props.inConflictFolder,
								plugins: props.plugins,
							});
						},
					})
				);
			}

			exportMenu.append(
				new MenuItem(
					menuUtils.commandToStatefulMenuItem('exportPdf', noteIds)
				)
			);

			const exportMenuItem = new MenuItem({ label: _('Export'), submenu: exportMenu });

			menu.append(exportMenuItem);
		}

		menu.append(
			new MenuItem({
				label: _('Delete'),
				click: async () => {
					await this.confirmDeleteNotes(noteIds);
				},
			})
		);

		const pluginViewInfos = pluginUtils.viewInfosByType(props.plugins, 'menuItem');

		for (const info of pluginViewInfos) {
			const location = info.view.location;
			if (location !== MenuItemLocation.Context && location !== MenuItemLocation.NoteListContextMenu) continue;

			menu.append(
				new MenuItem(menuUtils.commandToStatefulMenuItem(info.view.commandName, noteIds))
			);
		}

		return menu;
	}

	static async confirmDeleteNotes(noteIds: string[]) {
		if (!noteIds.length) return;

		let msg = '';
		if (noteIds.length === 1) {
			const note = await Note.load(noteIds[0]);
			if (!note) return;
			msg = _('Delete note "%s"?', substrWithEllipsis(note.title, 0, 32));
		} else {
			msg = _('Delete these %d notes?', noteIds.length);
		}

		const ok = bridge().showConfirmMessageBox(msg, {
			buttons: [_('Delete'), _('Cancel')],
			defaultId: 1,
		});

		if (!ok) return;
		await Note.batchDelete(noteIds);
	}

	private static async createSubPageList(noteId: string): Promise<SubpageList> {
		// TODO create subpagelist.
		const note = await Note.load(noteId);
		const parentFolderId = note.parent_id;
		const folder = await Folder.load(parentFolderId);
		const subpageList: SubpageList =
			{
				type: PageType.Folder,
				title: folder.title,
				id: folder.id,
				children: [],
			};
		await NoteListUtils.interCreateSubPageList(subpageList);
		return subpageList;
	}

	private static async interCreateSubPageList(subpageList: SubpageList) {
		if (subpageList.type === PageType.Note) {
			return;
		}
		const parentId = subpageList.id;
		const notes = await Note.previews(parentId, null);
		for (const note of notes) {
			const notePage: SubpageList = {
				type: PageType.Note,
				title: note.title,
				id: note.id,
				children: [],
			};
			subpageList.children.push(notePage);
		}
		subpageList.children.sort((a: SubpageList, b: SubpageList): number => {
			const nameA = a.title.toUpperCase();
			const nameB = b.title.toUpperCase();
			if (nameA < nameB) {
				return -1;
			}
			if (nameA > nameB) {
				return 1;
			}
			return 0;
		});
		const folderIds = await Folder.subFolderIds(parentId);
		for (const folderId of folderIds) {
			const folder = await Folder.load(folderId);
			const folderPage: SubpageList = {
				type: PageType.Folder,
				title: folder.title,
				id: folder.id,
				children: [],
			};
			await this.interCreateSubPageList(folderPage);
			subpageList.children.push(folderPage);
		}
		return;
	}

	private static convertSubpageListsToHTML(subpageLists: SubpageList[]): string {
		const $ = cheerio.load('<ul id="joplin_subpagelist"></ul>');
		const subpageList = subpageLists[0];
		const root = $('ul');
		NoteListUtils.interConvertSubpageListToHTML(subpageList, root);
		const html = $.html();
		console.log(`subpage html: ${JSON.stringify(html, null, ' ')}`);
		return html;
	}

	public static async updateSubpageLists($: cheerio.Root, noteId: string): Promise<cheerio.Root> {
		console.log(`before update: ${$.html()}`); 
		let root = $('#joplin_subpagelist');
		if (root.length <= 0) {
			return $;
		}
		root.find('*').remove();
		console.log(`removed update: ${$.html()}`);
		const subpageList = await NoteListUtils.createSubPageList(noteId)

		await NoteListUtils.interConvertSubpageListToHTML(subpageList, root);
		console.log(`update subpage: ${$.html()}`);
		return $;
	}

	private static interConvertSubpageListToHTML(subpageList: SubpageList, parent: cheerio.Cheerio): cheerio.Cheerio {

		if (subpageList.type === PageType.Note) {
			const li = cheerio.load(`<li><a href="joplin://${subpageList.id}">${subpageList.title}</a></li>`);
			li('li').appendTo(parent);
			return parent;
		}

		if (subpageList.type !== PageType.Folder) {
			return parent;
		}

		const litemp = cheerio.load(`<li>${subpageList.title}</li>`);
		const li = litemp('li');
		const ultemp = cheerio.load('<ul></ul>');
		const ul = ultemp('ul');

		for (const child of subpageList.children) {
			NoteListUtils.interConvertSubpageListToHTML(child, ul);
		}

		console.log(`before: ${JSON.stringify(parent.html(), null, ' ')}`);
		ul.appendTo(li);
		li.appendTo(parent);
		console.log(`before: ${JSON.stringify(parent.html(), null, ' ')}`);


		return parent;
	}

}
