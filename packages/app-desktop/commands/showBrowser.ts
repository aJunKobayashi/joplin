import { CommandRuntime, CommandDeclaration, CommandContext } from '@joplin/lib/services/CommandService';
import { _ } from '@joplin/lib/locale';
import { stateUtils } from '@joplin/lib/reducer';
// import ExternalEditWatcher from '@joplin/lib/services/ExternalEditWatcher';
import Note from '@joplin/lib/models/Note';
import { shell } from 'electron';
import Setting from '@joplin/lib/models/Setting';
import * as fs from 'fs';
import * as cheerio from 'cheerio';
import * as PATH from 'path';

const bridge = require('electron').remote.require('./bridge').default;



const escapeRegExp = (str: string): string => {
	return str.replace(/[.*+?^=!:${}()|[\]\/\\]/g, '\\$&');
};

export const modifyJoplinResource = ($: cheerio.Root, resourceDir: string): cheerio.Root => {
	const regex = new RegExp(`^${escapeRegExp('joplin_resource:/')}`);
	const anchors = $('a[href^="joplin_resource://"]');

	for (let i = 0; i < anchors.length; i++) {
		const anchor = anchors[i] as cheerio.TagElement;
		const href = anchor.attribs.href;
		const newHref = href.replace(regex, resourceDir);
		anchor.attribs.href = newHref;
	}

	const imgs = $('img[src^="joplin_resource://"]');
	for (let i = 0; i < imgs.length; i++) {
		const img = imgs[i] as cheerio.TagElement;
		const src = img.attribs.src;
		const newSrc = src.replace(regex, resourceDir);
		img.attribs.src = newSrc;
	}
	return $;
};

export const revertResourceDirToJoplinScheme = (htmlBody: string, resourceDir: string): cheerio.Root  => {
	const $ = cheerio.load(htmlBody);
	const anchors = $(`a[href^="${resourceDir}"]`);

	for (let i = 0; i < anchors.length; i++) {
		const anchor = anchors[i] as cheerio.TagElement;
		const href = anchor.attribs.href;
		const filename = PATH.basename(href);
		const newHref = `joplin_resource://${filename}`;
		anchor.attribs.href = newHref;
	}

	const imgs = $(`img[src^="${resourceDir}"]`);
	for (let i = 0; i < imgs.length; i++) {
		const img = imgs[i] as cheerio.TagElement;
		const src = img.attribs.src;
		const filename = PATH.basename(src);
		const newSrc = `joplin_resource://${filename}`;
		img.attribs.src = newSrc;
	}
	return $;
};



export const declaration: CommandDeclaration = {
	name: 'ShowBrowser',
	label: () => _('Show Browser'),
	iconName: 'icon-share',
};

export const runtime = (): CommandRuntime => {
	return {
		execute: async (context: CommandContext, noteId: string = null) => {
			noteId = noteId || stateUtils.selectedNoteId(context.state);
			await showNoteByBrowser(noteId);
		},
		enabledCondition: 'oneNoteSelected',
	};
};

export const showNoteByBrowser = async (noteId: string) => {
	try {
		const note = await Note.load(noteId);
		const path = `${Setting.value('tempDir')}/${note.title}.html`;
		const resourceDir = `${Setting.value('resourceDir')}`;
		let $ = cheerio.load(note.body);
		$ = modifyJoplinResource($, resourceDir);
		fs.writeFileSync(path, $.html());
		const url = `file://${path}`;
		await shell.openExternal(url);
	} catch (error) {
		bridge().showErrorMessageBox(_('Error opening note in editor: %s', error.message));
	}
};
