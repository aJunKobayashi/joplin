import InteropService_Exporter_Base from './InteropService_Exporter_Base';
import BaseModel from '../../BaseModel';
import shim from '../../shim';
import markupLanguageUtils from '../../markupLanguageUtils';
import Folder from '../../models/Folder';
import Note from '../../models/Note';
import Setting from '../../models/Setting';
import { MarkupToHtml } from '@joplin/renderer';
import { ResourceEntity } from '../database/types';
import { contentScriptsToRendererRules } from '../plugins/utils/loadContentScripts';
import * as cheerio from 'cheerio';
import * as PATH from 'path';

const { basename, friendlySafeFilename, rtrimSlashes } = require('../../path-utils');
const { themeStyle } = require('../../theme');
const { dirname } = require('../../path-utils');
const { escapeHtml } = require('../../string-utils.js');
const { assetsToHeaders } = require('@joplin/renderer');

export default class InteropService_Exporter_Html extends InteropService_Exporter_Base {

	private customCss_: string;
	private destDir_: string;
	private filePath_: string;
	private createdDirs_: string[] = [];
	private resourceDir_: string;
	private markupToHtml_: MarkupToHtml;
	private resources_: ResourceEntity[] = [];
	private style_: any;

	async init(path: string, options: any = {}) {
		this.customCss_ = options.customCss ? options.customCss : '';

		if (this.metadata().target === 'file') {
			this.destDir_ = dirname(path);
			this.filePath_ = path;
		} else {
			this.destDir_ = path;
			this.filePath_ = null;
		}

		this.resourceDir_ = this.destDir_ ? `${this.destDir_}/_resources` : null;

		await shim.fsDriver().mkdir(this.destDir_);
		this.markupToHtml_ = markupLanguageUtils.newMarkupToHtml({
			extraRendererRules: contentScriptsToRendererRules(options.plugins),
		});
		this.style_ = themeStyle(Setting.THEME_LIGHT);
	}

	async makeDirPath_(item: any, pathPart: string = null) {
		let output = '';
		while (true) {
			if (item.type_ === BaseModel.TYPE_FOLDER) {
				if (pathPart) {
					output = `${pathPart}/${output}`;
				} else {
					output = `${friendlySafeFilename(item.title, null, true)}/${output}`;
					output = await shim.fsDriver().findUniqueFilename(output);
				}
			}
			if (!item.parent_id) return output;
			item = await Folder.load(item.parent_id);
		}
	}

	async processNoteResources_(item: any) {
		const target = this.metadata().target;
		const linkedResourceIds = await Note.linkedResourceIds(item.body);
		const relativePath = target === 'directory' ? rtrimSlashes(await this.makeDirPath_(item, '..')) : '';
		const resourcePaths = this.context() && this.context().resourcePaths ? this.context().resourcePaths : {};

		let newBody = item.body;

		for (let i = 0; i < linkedResourceIds.length; i++) {
			const id = linkedResourceIds[i];
			const resourceContent = `${relativePath ? `${relativePath}/` : ''}_resources/${basename(resourcePaths[id])}`;
			newBody = newBody.replace(new RegExp(`:/${id}`, 'g'), resourceContent);
		}

		return newBody;
	}

	async createHtmlPath(item: any): Promise<string> {
		if ([BaseModel.TYPE_NOTE, BaseModel.TYPE_FOLDER].indexOf(item.type_) < 0) return '';

		let dirPath = '';
		let noteFilePath = ''
		if (!this.filePath_) {
			dirPath = `${this.destDir_}/${await this.makeDirPath_(item)}`;
		}
		if (this.filePath_) {
			noteFilePath = this.filePath_;
		} else {
			noteFilePath = PATH.join(dirPath, `${friendlySafeFilename(item.title, null, true)}.html`);
			noteFilePath = await shim.fsDriver().findUniqueFilename(noteFilePath);
		}
		return noteFilePath;
	}

	async processItem(_itemType: number, item: any) {
		if ([BaseModel.TYPE_NOTE, BaseModel.TYPE_FOLDER].indexOf(item.type_) < 0) return;

		let dirPath = '';
		if (!this.filePath_) {
			dirPath = `${this.destDir_}/${await this.makeDirPath_(item)}`;

			if (this.createdDirs_.indexOf(dirPath) < 0) {
				await shim.fsDriver().mkdir(dirPath);
				this.createdDirs_.push(dirPath);
			}
		}

		if (item.type_ === BaseModel.TYPE_NOTE) {
			let noteFilePath = '';

			if (this.filePath_) {
				noteFilePath = this.filePath_;
			} else {
				noteFilePath = `${dirPath}/${friendlySafeFilename(item.title, null, true)}.html`;
				noteFilePath = await shim.fsDriver().findUniqueFilename(noteFilePath);
			}

			const bodyMd = await this.processNoteResources_(item);
			const result = await this.markupToHtml_.render(item.markup_language, bodyMd, this.style_, {
				resources: this.resources_,
				plainResourceRendering: true,
				userCss: this.customCss_,
				noConvert: true,
			});
			const noteContent = [];
			if (item.title) noteContent.push(`<div class="exported-note-title">${escapeHtml(item.title)}</div>`);
			if (result.html) noteContent.push(result.html);

			const libRootPath = dirname(dirname(__dirname));

			// We need to export all the plugin assets too and refer them from the header
			// The source path is a bit hard-coded but shouldn't change.
			for (let i = 0; i < result.pluginAssets.length; i++) {
				const asset = result.pluginAssets[i];
				const filePath = asset.pathIsAbsolute ? asset.path : `${libRootPath}/node_modules/@joplin/renderer/assets/${asset.name}`;
				const destPath = `${dirname(noteFilePath)}/pluginAssets/${asset.name}`;
				await shim.fsDriver().mkdir(dirname(destPath));
				await shim.fsDriver().copy(filePath, destPath);
			}

			const fullHtml = `
				<!DOCTYPE html>
				<html>
					<head>
						<meta charset="UTF-8">
						${assetsToHeaders(result.pluginAssets, { asHtml: true })}
						<title>${escapeHtml(item.title)}</title>
					</head>
					<body>
						<div class="exported-note">${noteContent.join('\n\n')}</div>
					</body>
				</html>
			`;

			const srcResourcePath = `${Setting.value('resourceDir')}`;
			const dstResourcePath = PATH.join(this.destDir_, PATH.basename(srcResourcePath));
			const profileDirPath = `${Setting.value('profileDir')}`;
			let modifiedHtml = fullHtml;
			if (noteFilePath.indexOf(profileDirPath) !== 0) {
				const noteIdToPath: { [key: string]: string } = item.noteIdToPath;
				modifiedHtml = this.modifyExportHTMLSource(fullHtml, srcResourcePath, dstResourcePath, noteFilePath, noteIdToPath);
			}
			await shim.fsDriver().writeFile(noteFilePath, modifiedHtml, 'utf-8');
		}
	}

	modifyExportHTMLSource(fullHtml: string,
		srcResourcePath: string,
		dstResourcePath: string,
		noteFilePath: string,
		noteIdToPath: { [key: string]: string } ): string {
		console.log(`srcResourcePath: ${srcResourcePath}`);
		console.log(`dstResourcePath ${dstResourcePath}`);
		console.log(`noteFilePath: ${noteFilePath}`);
		let $ = cheerio.load(fullHtml);
		$ = this.convertImgSrcToRelativePath($, srcResourcePath, dstResourcePath, noteFilePath);
		$ = this.deleteNeedlessAttribute($);
		$ = this.deleteScriptTag($);
		$ = this.modifyJoplinLinkAnchor($, noteFilePath, noteIdToPath);
		return $.html();
	}

	modifyJoplinLinkAnchor($: cheerio.Root, noteFilePath: string, noteIdToPath: { [key: string]: string } ):  cheerio.Root {
		const joplinAnchors = $('a[href^=joplin://]')
		console.log(`noteFilePath: ${noteFilePath}`);
		for (let i = 0; i < joplinAnchors.length; i++) {
			const joplinAnchor = joplinAnchors[i] as  cheerio.TagElement ;
			const linkComponent = joplinAnchor.attribs.href.toLocaleLowerCase().split('joplin://');
			const targetId = linkComponent.length > 1 ? linkComponent[1] : '';
			console.log(`joplin link ID: ${targetId}`);
			const htmlPath = noteIdToPath[targetId];
			console.log(`link path: ${htmlPath}`);
			const srcDir = PATH.dirname(noteFilePath);
			const relativePath = PATH.relative(srcDir, htmlPath);
			joplinAnchor.attribs.href = relativePath;
		}
		return $;
	}

	deleteNeedlessAttribute($: cheerio.Root): cheerio.Root {
		const targetElements = $('[data-mce-src]');
		for (let i = 0; i < targetElements.length; i++) {
			const targetElement = targetElements[i] as cheerio.TagElement;
			delete targetElement.attribs['data-mce-src'];

		}
		return $;
	}

	deleteScriptTag($: cheerio.Root): cheerio.Root {
		$('script').remove('script');
		return $;
	}

	convertImgSrcToRelativePath($: cheerio.Root,
		srcResourcePath: string,
		dstResourcePath: string,
		noteFilePath: string): cheerio.Root {

		const imgs = $('img');

		const targetURI = `file://${srcResourcePath}`;
		for (let i = 0; i < imgs.length; i++) {
			const img: cheerio.TagElement = imgs[i] as cheerio.TagElement;
			if (img.attribs.src == undefined) {
				continue;
			}
			if (img.attribs.src.indexOf(targetURI) !== 0) {
				continue;
			}
			// TODO modify ResourceURL
			console.log(img.attribs.src);
			const imageFileName = PATH.basename(img.attribs.src);
			const noteDir = PATH.dirname(noteFilePath);
			console.log(`imageFileName: ${imageFileName}`);
			console.log(`noteDir: ${noteDir}`);
			const relativePath = PATH.relative(noteDir, dstResourcePath);
			console.log(`relativePath: ${relativePath}`);
			img.attribs.src = `${PATH.join(relativePath, imageFileName)}`;
			console.log(`new img.src:  ${img.attribs.src}`);
		}
		return $;
	}

	async processResource(resource: any, filePath: string) {
		const destResourcePath = `${this.resourceDir_}/${basename(filePath)}`;
		await shim.fsDriver().copy(filePath, destResourcePath);
		this.resources_.push(resource);
	}

	async close() {}
}
