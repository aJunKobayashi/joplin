/**
 * Electron 非依存の HTML エクスポーター
 *
 * packages/lib/services/interop/InteropService_Exporter_Html.ts と同等の機能を提供するが、
 * app-desktop (Electron) への依存を完全に排除している。
 *
 * app-desktop から移植した関数:
 * - revertResourceDirToJoplinScheme (showBrowser.ts)
 * - isAudio / isVideoAudio (showBrowser.ts)
 * - copyPluginAssetsIfNotExit (showBrowser.ts)
 * - extractToCAndPutHead (mergeNotes.ts)
 * - createEmbededFontCss (font_embed_css.ts)
 * - NoteListUtils.updateSubpageLists (NoteListUtils.ts)
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import * as cheerio from 'cheerio';
import * as PATH from 'path';
import * as URL from 'url';
import * as fs from 'fs';

const Setting = require('@joplin/lib/models/Setting').default;
const BaseModel = require('@joplin/lib/BaseModel').default;
const shim = require('@joplin/lib/shim').default;
const markupLanguageUtils = require('@joplin/lib/markupLanguageUtils').default;
const Folder = require('@joplin/lib/models/Folder').default;
const Note = require('@joplin/lib/models/Note').default;
const Resource = require('@joplin/lib/models/Resource').default;
const {
  contentScriptsToRendererRules,
} = require('@joplin/lib/services/plugins/utils/loadContentScripts');
const { basename, friendlySafeFilename, rtrimSlashes } = require('@joplin/lib/path-utils');
const { themeStyle } = require('@joplin/lib/theme');
const { dirname } = require('@joplin/lib/path-utils');
const { escapeHtml } = require('@joplin/lib/string-utils.js');

/**
 * @joplin/renderer の assetsToHeaders と同等の関数。
 * pluginAssets 配列を HTML の LINK/SCRIPT タグに変換する。
 */
function assetsToHeaders(
  pluginAssets: any[],
  options: { asHtml?: boolean } | null = null
): Record<string, string> | string {
  const opts = Object.assign({}, { asHtml: false }, options);
  const headers: Record<string, string> = {};
  for (const asset of pluginAssets) {
    if (asset.mime === 'text/css') {
      headers[asset.name] = `<link rel="stylesheet" href="pluginAssets/${asset.name}">`;
    } else if (asset.mime === 'application/javascript') {
      headers[asset.name] =
        `<script type="application/javascript" src="pluginAssets/${asset.name}"></script>`;
    }
  }
  if (opts.asHtml) {
    return Object.values(headers).join('');
  }
  return headers;
}

// ---------------------------------------------------------------------------
// app-desktop から移植したユーティリティ関数（Electron 非依存）
// ---------------------------------------------------------------------------

function revertResourceDirToJoplinScheme(htmlBody: string, resourceDir: string): cheerio.Root {
  const $ = cheerio.load(htmlBody);
  const anchors = [...$(`a[href^="file://${resourceDir}"]`), ...$(`a[href^="${resourceDir}"]`)];
  for (const anchor of anchors) {
    const el = anchor as cheerio.TagElement;
    const href = el.attribs.href;
    const filename = PATH.basename(href);
    el.attribs.href = `joplin_resource://${filename}`;
  }
  const imgs = [...$(`[src^="file://${resourceDir}"]`), ...$(`[src^="${resourceDir}"]`)];
  for (const img of imgs) {
    const el = img as cheerio.TagElement;
    const src = el.attribs.src;
    const filename = PATH.basename(src);
    el.attribs.src = `joplin_resource://${filename}`;
  }
  return $;
}

function isAudio(ext: string): boolean {
  const audioExtList = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
  return audioExtList.includes(ext.toLowerCase());
}

function isVideo(ext: string): boolean {
  const videoExtList = ['.mp4', '.webm', '.ogg', '.ogv', '.m4v', '.mov', '.mkv'];
  return videoExtList.includes(ext.toLowerCase());
}

function isVideoAudio(ext: string): boolean {
  return isAudio(ext) || isVideo(ext);
}

function extractToCAndPutHead(htmlBody: string, titles: string[]): string {
  const $ = cheerio.load(htmlBody);
  const grandParents: cheerio.Element[] = [];
  const tocs = $('div.mce-toc');
  for (let i = 0; i < tocs.length; i++) {
    const toc = tocs[i];
    const h2 = $(toc).find('h2');
    if (h2.length > 0) {
      $(h2).text(`目次: ${titles?.[i]}`);
    }
    grandParents.push(toc);
  }
  grandParents.reverse().forEach((gp) => {
    $('body').prepend($(gp));
  });
  return $.html();
}

async function copyPluginAssetsIfNotExit(): Promise<void> {
  // katex assets を renderer パッケージからコピーする
  const rendererAssetsDir = PATH.resolve(
    __dirname,
    '../../node_modules/@joplin/renderer/assets/katex'
  );
  // rendererAssetsDir が存在しない場合は lib 配下も探す
  let srcDir = rendererAssetsDir;
  if (!fs.existsSync(srcDir)) {
    srcDir = PATH.resolve(__dirname, '../../../lib/node_modules/@joplin/renderer/assets/katex');
  }
  const pluginDir = `${Setting.value('tempDir')}/pluginAssets`;
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
    if (fs.existsSync(srcDir)) {
      const fsExtra = require('fs-extra');
      await fsExtra.copy(srcDir, `${pluginDir}/katex`);
    }
  }
}

async function createEmbededFontCss(cssFilePath: string, outputPath: string): Promise<string> {
  const postcss = require('postcss');
  const inputCss = fs.readFileSync(cssFilePath, 'utf8');

  const encodeFont = (fontPath: string): string => {
    try {
      const fontData = fs.readFileSync(fontPath);
      return `data:font/woff2;base64,${fontData.toString('base64')}`;
    } catch (_err) {
      const fontfile = PATH.basename(fontPath);
      const foldername = PATH.basename(PATH.dirname(fontPath));
      return [foldername, fontfile].join('/');
    }
  };

  const plugin: any = {
    postcssPlugin: 'custom-plugin',
    Once(root: any) {
      root.walkAtRules('font-face', (rule: any) => {
        rule.walkDecls('src', (decl: any) => {
          const urlRegex = /url\((.*?)\)/g;
          const urls = decl.value
            .match(urlRegex)
            ?.map((match: string) => {
              const urlMatch = /url\((['"]?)(.*?)\1\)/.exec(match);
              return urlMatch ? urlMatch[2] : null;
            })
            .filter((u: string | null) => u !== null) as string[];

          const formatRegex = /format\((.*?)\)/g;
          const formats = decl.value
            .match(formatRegex)
            ?.map((match: string) => {
              const formatMatch = /format\((['"]?)(.*?)\1\)/.exec(match);
              return formatMatch ? formatMatch[2] : null;
            })
            .filter((f: string | null) => f !== null) as string[];

          const newValues = urls?.map((url: string, index: number) => {
            const fontPath = PATH.join(PATH.dirname(cssFilePath), url);
            return `url(${encodeFont(fontPath)}) format('${formats[index]}')`;
          });
          decl.value = newValues?.join(', ') || decl.value;
        });
      });
    },
  };

  const result = await postcss([plugin]).process(inputCss, { from: cssFilePath, to: outputPath });
  return result.css;
}

import { updateSubpageLists } from '../lib/subpageList';

// ---------------------------------------------------------------------------
// エクスポーター本体
// ---------------------------------------------------------------------------

interface HtmlItem {
  type_: number;
  id: string;
  parent_id: string;
  title: string;
  body: string;
  markup_language: number;
  noteIdToPath: { [key: string]: string };
  [key: string]: any;
}

export interface ExporterOptions {
  customCss?: string;
  embededImage?: boolean;
  plugins?: any;
}

export class ExporterHtmlCli {
  private customCss!: string;
  private destDir!: string;
  private createdDirs: string[] = [];
  private resourceDir!: string;
  private markupToHtml: any;
  private resources: any[] = [];
  private style: any;
  private embededImage: boolean = false;
  private embededFontCssStr!: string;

  async init(destDir: string, options: ExporterOptions = {}) {
    this.customCss = options.customCss || '';
    this.embededImage = options.embededImage || false;

    if (this.embededImage) {
      this.embededFontCssStr = await this.loadEmbededFontCss();
    }

    this.destDir = destDir;
    this.resourceDir = `${this.destDir}/_resources`;

    await shim.fsDriver().mkdir(this.destDir);
    this.markupToHtml = markupLanguageUtils.newMarkupToHtml({
      extraRendererRules: contentScriptsToRendererRules(options.plugins),
    });
    this.style = themeStyle(Setting.THEME_LIGHT);
  }

  private async loadEmbededFontCss(): Promise<string> {
    await copyPluginAssetsIfNotExit();
    const cssFilePath = `${Setting.value('tempDir')}/pluginAssets/katex/katex.css`;
    const outFilePath = `${Setting.value('tempDir')}/pluginAssets/katex/output.css`;
    if (!fs.existsSync(cssFilePath)) {
      console.warn(`KaTeX CSS not found: ${cssFilePath}, skipping font embedding`);
      return '';
    }
    return await createEmbededFontCss(cssFilePath, outFilePath);
  }

  private async makeDirPath(item: any, pathPart: string | null = null): Promise<string> {
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

  private async processNoteResources(item: any): Promise<string> {
    const linkedResourceIds = await Note.linkedResourceIds(item.body);
    const relativePath = rtrimSlashes(await this.makeDirPath(item, '..'));
    const resourcePaths = this.context?.resourcePaths || {};
    let newBody = item.body;
    for (const id of linkedResourceIds) {
      const resourceContent = `${relativePath ? `${relativePath}/` : ''}_resources/${basename(resourcePaths[id])}`;
      newBody = newBody.replace(new RegExp(`:/${id}`, 'g'), resourceContent);
    }
    return newBody;
  }

  private context: any = { resourcePaths: {} };

  updateContext(ctx: any) {
    this.context = Object.assign({}, this.context, ctx);
  }

  async createHtmlPath(item: any): Promise<string> {
    if ([BaseModel.TYPE_NOTE, BaseModel.TYPE_FOLDER].indexOf(item.type_) < 0) return '';
    let dirPath = '';
    let noteFilePath = '';
    dirPath = `${this.destDir}/${await this.makeDirPath(item)}`;
    noteFilePath = PATH.join(dirPath, `${friendlySafeFilename(item.title, null, true)}.html`);
    noteFilePath = await shim.fsDriver().findUniqueFilename(noteFilePath);
    return noteFilePath;
  }

  async processItem(item: any) {
    if ([BaseModel.TYPE_NOTE, BaseModel.TYPE_FOLDER].indexOf(item.type_) < 0) return;

    let dirPath = '';
    dirPath = `${this.destDir}/${await this.makeDirPath(item)}`;
    if (this.createdDirs.indexOf(dirPath) < 0) {
      await shim.fsDriver().mkdir(dirPath);
      this.createdDirs.push(dirPath);
    }

    if (item.type_ === BaseModel.TYPE_NOTE) {
      let noteFilePath = `${dirPath}/${friendlySafeFilename(item.title, null, true)}.html`;
      noteFilePath = await shim.fsDriver().findUniqueFilename(noteFilePath);

      const bodyMd = await this.processNoteResources(item);
      const result = await this.markupToHtml.render(item.markup_language, bodyMd, this.style, {
        resources: this.resources,
        plainResourceRendering: true,
        userCss: this.customCss,
        noConvert: true,
      });

      const noteContent: string[] = [];
      if (item.title)
        noteContent.push(`<div class="exported-note-title">${escapeHtml(item.title)}</div>`);
      if (result.html) noteContent.push(result.html);

      const publicPluginAssetsDir = PATH.resolve(__dirname, '../public/pluginAssets');
      for (const asset of result.pluginAssets) {
        const filePath = asset.pathIsAbsolute
          ? asset.path
          : PATH.join(publicPluginAssetsDir, asset.name);
        const destPath = `${dirname(noteFilePath)}/pluginAssets/${asset.name}`;
        await shim.fsDriver().mkdir(dirname(destPath));
        if (fs.existsSync(filePath)) {
          await shim.fsDriver().copy(filePath, destPath);
        }
      }
      // katex/fonts はアセット一覧に個別には含まれないため、ディレクトリごとコピーする
      const hasKatex = result.pluginAssets.some((a: any) => a.name?.startsWith('katex/'));
      if (hasKatex) {
        const katexFontsSrc = PATH.join(publicPluginAssetsDir, 'katex/fonts');
        const katexFontsDst = PATH.join(dirname(noteFilePath), 'pluginAssets/katex/fonts');
        if (fs.existsSync(katexFontsSrc)) {
          const fsExtra = require('fs-extra');
          await fsExtra.copy(katexFontsSrc, katexFontsDst);
        }
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
</html>`;

      const srcResourcePath = `${Setting.value('resourceDir')}`;
      const dstResourcePath = PATH.join(this.destDir, PATH.basename(srcResourcePath));
      const profileDirPath = `${Setting.value('profileDir')}`;

      let modifiedHtml = fullHtml;
      if (noteFilePath.indexOf(profileDirPath) !== 0) {
        const noteIdToPath: { [key: string]: string } = item.noteIdToPath || {};
        const noteId = item.id;
        modifiedHtml = await this.modifyExportHTMLSource(
          fullHtml,
          srcResourcePath,
          dstResourcePath,
          noteId,
          noteFilePath,
          noteIdToPath
        );
      } else {
        modifiedHtml = ExporterHtmlCli.modifyJoplinResource(fullHtml, Setting.value('resourceDir'));
      }

      await shim.fsDriver().writeFile(noteFilePath, modifiedHtml, 'utf-8');
    }
  }

  async processResource(resource: any, filePath: string) {
    const destResourcePath = `${this.resourceDir}/${basename(filePath)}`;
    await shim.fsDriver().copy(filePath, destResourcePath);
    this.resources.push(resource);
  }

  // -----------------------------------------------------------------------
  // HTML 変換ヘルパー
  // -----------------------------------------------------------------------

  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^=!:${}()|[\]/\\]/g, '\\$&');
  }

  private static modifyJoplinResource(fullHTML: string, resourceDir: string): string {
    const $ = cheerio.load(fullHTML);
    const regex = new RegExp(`^${ExporterHtmlCli.escapeRegExp('joplin_resource:/')}`);
    const anchors = $('a[href^="joplin_resource://"]');
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i] as cheerio.TagElement;
      anchor.attribs.href = anchor.attribs.href.replace(regex, resourceDir);
    }
    const imgs = $('img[src^="joplin_resource://"]');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i] as cheerio.TagElement;
      img.attribs.src = img.attribs.src.replace(regex, resourceDir);
    }
    return $.html();
  }

  private async modifyExportHTMLSource(
    fullHtml: string,
    _srcResourcePath: string,
    dstResourcePath: string,
    noteId: string,
    noteFilePath: string,
    noteIdToPath: { [key: string]: string }
  ): Promise<string> {
    const resourceDir = Setting.value('resourceDir');
    let $ = cheerio.load(fullHtml);
    $ = updateSubpageLists($, noteId);
    $ = revertResourceDirToJoplinScheme($.html(), resourceDir);
    $ = this.convertImgSrcToRelativePath($, dstResourcePath, noteFilePath);
    $ = this.deleteNeedlessAttribute($);
    $ = this.deleteScriptTag($);
    $ = this.modifyJoplinLinkAnchor($, noteFilePath, noteIdToPath);
    $ = this.convertJoplinSchemeAnchorToRelativePath($, dstResourcePath, noteFilePath);
    if (this.embededImage && this.embededFontCssStr) {
      $('<style>').text(this.embededFontCssStr).appendTo($('head'));
    }
    return $.html();
  }

  private modifyJoplinLinkAnchor(
    $: cheerio.Root,
    noteFilePath: string,
    noteIdToPath: { [key: string]: string }
  ): cheerio.Root {
    const joplinAnchors = $('a[href^=joplin://]');
    for (let i = 0; i < joplinAnchors.length; i++) {
      const joplinAnchor = joplinAnchors[i] as cheerio.TagElement;
      const url = URL.parse(joplinAnchor.attribs.href);
      if (!url.hostname) continue;
      const targetId = url.hostname;
      const htmlPath = noteIdToPath[targetId];
      // if (!htmlPath) continue;
      const srcDir = PATH.dirname(noteFilePath);
      try {
        let relativePath = PATH.relative(srcDir, htmlPath);
        if (url.hash) relativePath += url.hash;
        joplinAnchor.attribs.href = relativePath;
      } catch (e) {
        console.log(
          `error cannot calc relativepath: srcDir: ${srcDir}, dstDir: ${htmlPath}, ${joplinAnchor.attribs.href}`
        );
      }
    }
    return $;
  }

  private deleteNeedlessAttribute($: cheerio.Root): cheerio.Root {
    const targets = $('[data-mce-src]');
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i] as cheerio.TagElement;
      delete el.attribs['data-mce-src'];
    }
    return $;
  }

  private deleteScriptTag($: cheerio.Root): cheerio.Root {
    $('script').remove('script');
    return $;
  }

  private convertImgSrcToRelativePath(
    $: cheerio.Root,
    dstResourcePath: string,
    noteFilePath: string
  ): cheerio.Root {
    const imgs = $('[src^="joplin_resource://"]');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i] as cheerio.TagElement;
      const imageFileName = PATH.basename(img.attribs.src);
      const noteDir = PATH.dirname(noteFilePath);
      const relativePath = PATH.relative(noteDir, dstResourcePath);
      if (this.embededImage) {
        const fileAbsPath = PATH.join(dstResourcePath, imageFileName);
        img.attribs.src = ExporterHtmlCli.createBase64Resource(fileAbsPath);
      } else {
        img.attribs.src = PATH.join(relativePath, imageFileName);
      }
    }
    return $;
  }

  private convertJoplinSchemeAnchorToRelativePath(
    $: cheerio.Root,
    dstResourcePath: string,
    noteFilePath: string
  ): cheerio.Root {
    const anchors = $('a[href^="joplin_resource://"]');
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i] as cheerio.TagElement;
      const imageFileName = PATH.basename(anchor.attribs.href);
      const noteDir = PATH.dirname(noteFilePath);
      const relativePath = PATH.relative(noteDir, dstResourcePath);
      if (this.embededImage) {
        const fileAbsPath = PATH.join(dstResourcePath, imageFileName);
        anchor.attribs.href = ExporterHtmlCli.createBase64File(fileAbsPath);
        anchor.attribs.download = $(anchor).text() || 'temp.txt';
      } else {
        anchor.attribs.href = PATH.join(relativePath, imageFileName);
      }
    }
    return $;
  }

  private static createBase64Resource(imgPath: string): string {
    try {
      const pathWithoutQuery = imgPath.split('?')[0];
      const ext = PATH.extname(pathWithoutQuery).toLowerCase();
      const format = ext.split('.')[1];
      const base64Img = fs.readFileSync(pathWithoutQuery, { encoding: 'base64' });
      if (isAudio(ext)) return `data:audio/${format};base64, ${base64Img}`;
      if (isVideoAudio(ext)) return `data:video/${format};base64, ${base64Img}`;
      return `data:image/${format};base64, ${base64Img}`;
    } catch (e: any) {
      console.log(`cannot read img: ${imgPath}, error: ${e.toString()}`);
      return '';
    }
  }

  private static getMimeTypeByExtension(filepath: string): string {
    const ext = PATH.basename(filepath).split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      txt: 'text/plain',
      html: 'text/html',
      json: 'application/json',
      csv: 'text/csv',
      pdf: 'application/pdf',
      zip: 'application/zip',
      '7z': 'application/x-7z-compressed',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
    };
    return map[ext] || 'application/octet-stream';
  }

  private static createBase64File(imgPath: string): string {
    try {
      const pathWithoutQuery = imgPath.split('?')[0];
      const format = ExporterHtmlCli.getMimeTypeByExtension(pathWithoutQuery);
      const base64File = fs.readFileSync(pathWithoutQuery, { encoding: 'base64' });
      return `data:image/${format};base64, ${base64File}`;
    } catch (e: any) {
      console.log(`cannot read file: ${imgPath}, error: ${e.toString()}`);
      return '';
    }
  }

  async close() {}
}
