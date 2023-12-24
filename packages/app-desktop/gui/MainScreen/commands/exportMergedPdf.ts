import { CommandRuntime, CommandDeclaration, CommandContext } from '@joplin/lib/services/CommandService';
// import shim from '@joplin/lib/shim';
// import InteropServiceHelper from '../../../InteropServiceHelper';
import { _ } from '@joplin/lib/locale';
import { createMergedNoteBody } from './mergeNotes';
import Folder from '@joplin/lib/models/Folder';
const bridge = require('electron').remote.require('./bridge').default;
// import Note from '@joplin/lib/models/Note';
// const bridge = require('electron').remote.require('./bridge').default;

export const declaration: CommandDeclaration = {
	name: 'exportMergedPdf',
	label: () => `PDF - ${_('Merged PDF File')}`,
};

export const runtime = (comp: any): CommandRuntime => {
	return {
		execute: async (__: CommandContext, folderId: string) => {
			console.log(`folderId: ${folderId}`);
			const mergedNoteBody = await createMergedNoteBody(folderId);
			let path = null;
			const folder = await Folder.load(folderId);
			path = bridge().showSaveDialog({
				filters: [{ name: _('PDF File'), extensions: ['pdf'] }],
				defaultPath: `${folder.title}.pdf`,
			});


			if (!path) return;
			const pdfPath = path;
			await comp.printTo_('pdf', { path: pdfPath, noteId: null, htmlBody: mergedNoteBody });

		},

		enabledCondition: 'someNotesSelected',
	};
};
