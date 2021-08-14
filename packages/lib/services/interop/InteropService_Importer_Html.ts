import { ImportExportResult } from './types';
import { _ } from '../../locale';

import InteropService_Importer_Base from './InteropService_Importer_Base';
import Folder from '../../models/Folder';
import Note from '../../models/Note';
import * as PATH from 'path';
const { basename, rtrimSlashes, fileExtension } = require('../../path-utils');
import shim from '../../shim';
import { FolderEntity } from '../database/types';
import * as cheerio from 'cheerio';
import * as URL from 'url';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Setting from '../../models/Setting';

const { MarkupToHtml } = require('@joplin/renderer');

interface INoteInfoMap {
	pathToId: { [key: string]: string };
	IdToPath: { [key: string]: string };
}

export default class InteropService_Importer_Html extends InteropService_Importer_Base {
	private static readonly skipDir = 'attachment';

	async exec(result: ImportExportResult) {
		let parentFolderId = null;
		const noteInfos: INoteInfoMap = { pathToId: {}, IdToPath: {} };
		const sourcePath = rtrimSlashes(this.sourcePath_);

		const filePaths = [];

		if (await shim.fsDriver().isDirectory(sourcePath)) {
			if (!this.options_.destinationFolder) {
				// const folderTitle = await Folder.findUniqueItemTitle(basename(sourcePath));
				// const folder = await Folder.save({ title: folderTitle });
				parentFolderId = null;
			} else {
				parentFolderId = this.options_.destinationFolder.id;
			}

			await this.importDirectory(sourcePath, parentFolderId, noteInfos);
		} else {
			if (!this.options_.destinationFolder) throw new Error(_('Please specify the notebook where the notes should be imported to.'));
			parentFolderId = this.options_.destinationFolder.id;
			filePaths.push(sourcePath);
		}

		for (let i = 0; i < filePaths.length; i++) {
			await this.importFile(filePaths[i], parentFolderId, noteInfos);
		}

		// change links for other notes  to joplin://
		await InteropService_Importer_Html.convertInternalLinks(noteInfos);
		return result;
	}

	private static async convertInternalLinks(noteInfos: INoteInfoMap): Promise<void> {
		const notePaths = Object.keys(noteInfos.pathToId);
		for (const notePath of notePaths) {
			const noteId = noteInfos.pathToId[notePath];
			await InteropService_Importer_Html.convertInternalLink(noteId, notePath, noteInfos);
			// console.log(`noteObj: ${JSON.stringify(noteObj, null, ' ')}`);
		}
		return;
	}

	private static async convertInternalLink(noteId: string, notePath: string, noteInfos:INoteInfoMap): Promise<void> {
		try {
			const note = await Note.loadItemById(noteId);
			const body = note.body;
			const $ = cheerio.load(body);
			const anchors = $('a[href$="index.html"]');
			for (let i = 0; i < anchors.length; i++) {
				const anchor = anchors[i] as cheerio.TagElement;
				const href = anchor.attribs.href;
				if (!InteropService_Importer_Html.isRelative(href)) {
					continue;
				}
				const absolutePath = PATH.join(PATH.dirname(notePath), href);
				const linkNoteId = noteInfos.pathToId[absolutePath];
				if (linkNoteId === undefined) {
					continue;
				}
				anchor.attribs.href = `joplin://${linkNoteId}`;
 			}
			note.body = $.html();
			await Note.save(note);
		} catch (e) {
			console.log(`error in convertInternalLink: ${e}`);
		}
	}

	hasDirectory(stats: any[]): boolean {
		for (let i = 0; i < stats.length; i++) {
			const stat = stats[i];
			const foldername = basename(stat.path);
			if (stat.isDirectory() && foldername !== InteropService_Importer_Html.skipDir) {
				return true;
			}
		}
		return false;
	}

	getTitleFromGoogleHTMLFile(htmlBody: string) {
		let title = '';
		try {
			const $ = cheerio.load(htmlBody);
			const titleElement = $('#sites-page-title')[0] as cheerio.TagElement;
			title = $(titleElement).text();
		} catch (e) {
			console.log(`error gettting title: ${e}`);
		}
		return title;
	}

	async getFolderTitle(dirPath: string): Promise<string> {
		const filePath = PATH.join(dirPath, 'index.html');
		let title = '';
		try {
			const body = await shim.fsDriver().readFile(filePath);
			title = this.getTitleFromGoogleHTMLFile(body);
		} catch (e) {
			console.log(`error gettting title: ${e}`);
		}
		return title ? title : basename(dirPath);
	}

	async importDirectory(dirPath: string, parentFolderId: string, noteInfos: INoteInfoMap) {
		if (PATH.basename(dirPath) === InteropService_Importer_Html.skipDir) {
			console.log(`skipDir: ${dirPath}`);
			return;
		}
		console.info(`Import: ${dirPath}`);
		const supportedFileExtension = ['html'];
		const foldername = await this.getFolderTitle(dirPath);
		const stats = await shim.fsDriver().readDirStats(dirPath);
		const folderTitle = await Folder.findUniqueItemTitle(foldername);

		let folderId = parentFolderId;
		// 作成対象ディレクトリ内に子ディレクトが存在する場合のみフォルダを作る
		if (this.hasDirectory(stats)) {
			const folderEntity: FolderEntity = { title: folderTitle };
			if (parentFolderId !== null) {
				folderEntity.parent_id = parentFolderId;
			}
			const folder = await Folder.save(folderEntity);
			folderId = folder.id;
		}



		for (let i = 0; i < stats.length; i++) {
			const stat = stats[i];

			if (stat.isDirectory()) {
				await this.importDirectory(`${dirPath}/${basename(stat.path)}`, folderId, noteInfos);
			} else if (supportedFileExtension.indexOf(fileExtension(stat.path).toLowerCase()) >= 0) {
				await this.importFile(`${dirPath}/${stat.path}`, folderId, noteInfos);
			}
		}
	}



	async importFile(filePath: string, parentFolderId: string, noteInfos: INoteInfoMap) {
		const stat = await shim.fsDriver().stat(filePath);
		if (!stat) throw new Error(`Cannot read ${filePath}`);
		const body = await shim.fsDriver().readFile(filePath);
		let title = this.getTitleFromGoogleHTMLFile(body);
		if (!title) {
			title = PATH.basename(PATH.dirname(filePath));
		}
		const resourceDir = Setting.value('resourceDir');
		const updatedBody = this.modifyGoogleSiteHtml(body, filePath, resourceDir);
		const note = {
			parent_id: parentFolderId,
			title: title,
			body: updatedBody || body,
			updated_time: stat.mtime.getTime(),
			created_time: stat.birthtime.getTime(),
			user_updated_time: stat.mtime.getTime(),
			user_created_time: stat.birthtime.getTime(),
			markup_language: MarkupToHtml.MARKUP_LANGUAGE_MARKDOWN,
		};

		const noteObj = await Note.save(note, { autoTimestamp: false });
		noteInfos.IdToPath[noteObj.id] = filePath;
		noteInfos.pathToId[filePath] = noteObj.id;
		console.log(`note: ${filePath} is saved!`);
		return noteObj;
	}

	modifyGoogleSiteHtml(htmlBody: string, filePath: string, resourceDir: string): string {
		let $ = cheerio.load(htmlBody);
		// Googleサイトのページのメイン部分だけを取得
		$ = this.getGoogleSitePageMainContent($);
		$ = this.modifyH2_4ToH1_3($);
		$ = this.importLocalImage($, filePath, resourceDir);
		$ = this.importRelativePathAnchor($, filePath, resourceDir);
		return $.html();
	}

	private static isRelative(urlstr: string): boolean {
		try {
			const parsed = URL.parse(urlstr);
			return parsed.protocol === null && !PATH.isAbsolute(urlstr);
		} catch (e) {
			return false;
		}
	}

	private static isFragmentLink(href: string): boolean {
		return !href || href.indexOf('#') === 0;
	}

	private static isLinkToIndexHtml(href: string): boolean {
		const regex = new RegExp('/index.html$');
		const regex2 = new RegExp('^index.html$');
		const lhref = href.toLocaleLowerCase();
		return regex.test(lhref) || regex2.test(lhref);
	}


	importRelativePathAnchor($: cheerio.Root, htmlPath: string, resourceDir: string): cheerio.Root {
		const anchors = $('a');
		for (let i = 0; i < anchors.length; i++) {
			const anchor = anchors[i] as cheerio.TagElement;
			const href = anchor.attribs.href;
			if (!href || !InteropService_Importer_Html.isRelative(href)
			|| InteropService_Importer_Html.isFragmentLink(href)
			|| InteropService_Importer_Html.isLinkToIndexHtml(href)) {
				continue;
			}
			console.log(`${htmlPath}, ${resourceDir}`);
			console.log(`relative anchor: ${href}`);

			const ext = PATH.extname(href.split('?')[0]);
			let downloadName = '';
			let absolutePath = PATH.join(PATH.dirname(htmlPath), href);
			if (PATH.basename(absolutePath).indexOf('?attredirects=') !== -1) {
				const splittedFilename = PATH.basename(absolutePath).split('?')[0];
				absolutePath = PATH.join(PATH.dirname(absolutePath), InteropService_Importer_Html.skipDir, splittedFilename);
				downloadName = splittedFilename;
			}
			console.log(`anchor absolute path: ${absolutePath}`);
			try {

				const data = fs.readFileSync(absolutePath);
				const hash = crypto.createHash('sha256').update(data).digest('hex');
				console.log(`anchor sha256 hash: ${hash}`);
				const filename = `${hash}${ext}`;
				console.log(`anchor filename: ${PATH.basename(href)} --> ${filename}`);
				const newFilePath = PATH.join(resourceDir, filename);
				console.log(`anchor new filepath: ${newFilePath}`);
				anchor.attribs.href = `file://${newFilePath}`;
				anchor.attribs.alt = `${PATH.basename(href)}`;
				if (downloadName) {
					anchor.attribs.download = downloadName;
				}
				fs.writeFileSync(newFilePath, data);
			} catch (e) {
				console.log(`import anchor error: ${e}`);
				console.log(`importing anchor error: ${absolutePath}`);
			}
		}
		return $;
	}

	importLocalImage($: cheerio.Root, htmlPath: string, resourceDir: string): cheerio.Root {
		const imgs = $('img');
		for (let i = 0; i < imgs.length; i++) {
			const img = imgs[i] as cheerio.TagElement;
			const src = img.attribs.src;
			if (!src || !InteropService_Importer_Html.isRelative(src)) {
				continue;
			}
			console.log(`find relative path image: ${src}`);
			const ext = PATH.extname(src);
			const absolutePath = PATH.join(PATH.dirname(htmlPath), src);
			console.log(`absolute path: ${absolutePath}`);
			const data = fs.readFileSync(absolutePath);
			const hash = crypto.createHash('sha256').update(data).digest('hex');
			console.log(`sha256 hash: ${hash}`);
			const filename = `${hash}${ext}`;
			console.log(`filename: ${PATH.basename(src)} --> ${filename}`);
			const newFilePath = PATH.join(resourceDir, filename);
			console.log(`new filepath: ${newFilePath}`);
			img.attribs.src = `file://${newFilePath}`;
			img.attribs.alt = `${PATH.basename(src)}`;
			fs.writeFileSync(newFilePath, data);

		}
		return $;
	}

	getGoogleSitePageMainContent($: cheerio.Root): cheerio.Root {
		const mainContent = $('#sites-canvas-main-content > table > tbody > tr > td > div');
		const new$ = cheerio.load(mainContent.html());
		return new$;
	}

	modifyHx($: cheerio.Root, targetNum: number): cheerio.Root {
		const hxs = $(`h${targetNum}`);
		for (let i = 0; i < hxs.length; i++) {
			const hx = hxs[i] as cheerio.TagElement;
			hx.name = `h${targetNum - 1}`;
		}
		return $;

	}

	modifyH2_4ToH1_3($: cheerio.Root): cheerio.Root {
		$ = this.modifyHx($, 2);
		$ = this.modifyHx($, 3);
		$ = this.modifyHx($, 4);

		return $;
	}
}
