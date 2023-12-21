import { CommandContext, CommandDeclaration, CommandRuntime } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import Folder from '@joplin/lib/models/Folder';
import Note from '@joplin/lib/models/Note';
// const bridge = require('electron').remote.require('./bridge').default;

export interface NoteInfo {
    id: string;
    parent_id: string;
    title: string;
    body: string;
    created_time: number;
    updated_time: number;
    is_conflict: number;
    latitude: string;
    longitude: string;
    altitude: string;
    author: string;
    source_url: string;
    is_todo: number;
    todo_due: number;
    todo_completed: number;
    source: string;
    source_application: string;
    application_data: string;
    order: number;
    user_created_time: number;
    user_updated_time: number;
    encryption_cipher_text: string;
    encryption_applied: number;
    markup_language: number;
    is_shared: number;
    type_: number;
}


export const declaration: CommandDeclaration = {
	name: 'mergeNotes',
	label: () => _('mergeNotes'),
	iconName: 'fa-book',
};

export const runtime = (_: any): CommandRuntime => {
	return {
		execute: async (_context: CommandContext, parentId: string = null) => {
			console.log(`parntId: ${parentId}`);
			const noteIds: string[] = await Folder.noteIds(parentId);
			console.log(`noteIds: ${JSON.stringify(noteIds, null, 2)}`);

			const notes: NoteInfo[] = await Note.loadItemsByIds(noteIds);
			console.log(`notes: ${JSON.stringify(notes, null, 2)}`);

			const sortedNotes = notes.sort((a: NoteInfo, b: NoteInfo) => {
				const title1 = a.title;
				const title2 = b.title;
				return title1.localeCompare(title2);
			});
			let mergedBody = '';
			for (const note of sortedNotes) {
				mergedBody += note.body;
			}
		},
	};
};
