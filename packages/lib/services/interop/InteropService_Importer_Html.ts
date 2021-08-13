import { ImportExportResult } from './types';
import { _ } from '../../locale';

import InteropService_Importer_Base from './InteropService_Importer_Base';
import Folder from '../../models/Folder';
import Note from '../../models/Note';
import * as PATH from 'path';
const { basename, filename, rtrimSlashes, fileExtension, dirname } = require('../../path-utils');
import shim from '../../shim';
import markdownUtils from '../../markdownUtils';
import { FolderEntity } from '../database/types';
import * as cheerio from 'cheerio';

const { unique } = require('../../ArrayUtils');
const { pregQuote } = require('../../string-utils-common');
const { MarkupToHtml } = require('@joplin/renderer');

export default class InteropService_Importer_Html extends InteropService_Importer_Base {
	async exec(result: ImportExportResult) {
		let parentFolderId = null;

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

			await this.importDirectory(sourcePath, parentFolderId);
		} else {
			if (!this.options_.destinationFolder) throw new Error(_('Please specify the notebook where the notes should be imported to.'));
			parentFolderId = this.options_.destinationFolder.id;
			filePaths.push(sourcePath);
		}

		for (let i = 0; i < filePaths.length; i++) {
			await this.importFile(filePaths[i], parentFolderId);
		}

		return result;
	}

	hasDirectory(stats: any[]): boolean {
		for (let i = 0; i < stats.length; i++) {
			const stat = stats[i];
			if (stat.isDirectory()) {
				return true;
			}
		}
		return false;
	}

	async importDirectory(dirPath: string, parentFolderId: string) {
		console.info(`Import: ${dirPath}`);
		const supportedFileExtension = ['html'];

		const stats = await shim.fsDriver().readDirStats(dirPath);
		const folderTitle = await Folder.findUniqueItemTitle(basename(dirPath));

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
				await this.importDirectory(`${dirPath}/${basename(stat.path)}`, folderId);
			} else if (supportedFileExtension.indexOf(fileExtension(stat.path).toLowerCase()) >= 0) {
				await this.importFile(`${dirPath}/${stat.path}`, folderId);
			}
		}
	}

	/**
	 * Parse text for links, attempt to find local file, if found create Joplin resource
	 * and update link accordingly.
	 */
	async importLocalImages(filePath: string, md: string) {
		let updated = md;
		const imageLinks = unique(markdownUtils.extractImageUrls(md));
		await Promise.all(imageLinks.map(async (encodedLink: string) => {
			const link = decodeURI(encodedLink);
			const attachmentPath = filename(`${dirname(filePath)}/${link}`, true);
			const pathWithExtension = `${attachmentPath}.${fileExtension(link)}`;
			const stat = await shim.fsDriver().stat(pathWithExtension);
			const isDir = stat ? stat.isDirectory() : false;
			if (stat && !isDir) {
				const resource = await shim.createResourceFromPath(pathWithExtension);
				// NOTE: use ](link) in case the link also appears elsewhere, such as in alt text
				const linkPatternEscaped = pregQuote(`](${link})`);
				const reg = new RegExp(linkPatternEscaped, 'g');
				updated = updated.replace(reg, `](:/${resource.id})`);
			}
		}));
		return updated;
	}

	async importFile(filePath: string, parentFolderId: string) {
		const stat = await shim.fsDriver().stat(filePath);
		if (!stat) throw new Error(`Cannot read ${filePath}`);
		const title = PATH.basename(PATH.dirname(filePath));
		const body = await shim.fsDriver().readFile(filePath);
		const updatedBody = this.modifyGoogleSiteHtml(body);
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
		console.log(`note: ${filePath} is saved!`);
		return noteObj;
	}

	modifyGoogleSiteHtml(htmlBody: string): string {
		let $ = cheerio.load(htmlBody);
		// Googleサイトのページのメイン部分だけを取得
		$ = this.getGoogleSitePageMainContent($);
		$ = this.modifyH2_4ToH1_3($);
		return $.html();
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
