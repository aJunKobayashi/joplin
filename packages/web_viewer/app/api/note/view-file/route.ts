import { NextRequest, NextResponse } from 'next/server';
import { Note } from '@/lib/note';
import { ViewerUtil } from '@/lib/viewerUtil';
import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';

const getBrowserNoteStyle = (): string => {
  return `
    <style>
      body {
        font-family: 'Avenir', 'Arial', sans-serif;
        word-wrap: break-word;
        line-height: 1.6;
        padding: 1em;
      }
      table {
        text-align: left;
        border-collapse: collapse;
        border: 1px solid #d0d7de;
        background-color: #fff;
        margin-top: .6em;
        margin-bottom: .65em;
      }
      table td, table th {
        text-align: left;
        padding: .5em 1em .5em 1em;
        border: 1px solid #d0d7de;
      }
      table th {
        border-bottom: 2px solid #d0d7de;
        background-color: #f5f5f5;
      }
      table tr:nth-child(even) {
        background-color: #f5f5f5;
      }
      table tr:hover {
        background-color: #efefef;
      }
      blockquote {
        border-left: 4px solid #d0d7de;
        padding-left: 1.2em;
        margin-left: 0;
        opacity: .7;
      }
      hr {
        border: none;
        border-bottom: 2px solid #d0d7de;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      code {
        border: 1px solid #d0d7de;
        background-color: #f0f0f0;
        padding-right: .2em;
        padding-left: .2em;
        border-radius: .25em;
      }
      pre code {
        display: block;
        padding: 0.5em;
        overflow-x: auto;
      }
      h1 {
        font-size: 1.5em;
        font-weight: bold;
        border-bottom: 1px solid #d0d7de;
        padding-bottom: .3em;
      }
      h2 {
        font-size: 1.3em;
        font-weight: bold;
      }
      h3 {
        font-size: 1.1em;
      }
      p, h1, h2, h3, h4, h5, h6, ul, table {
        margin-top: .6em;
        margin-bottom: .65em;
      }
    </style>
  `;
};

const copyPluginAssetsIfNotExist = (pluginDir: string): void => {
  if (!fs.existsSync(pluginDir)) {
    const srcKatexDir = path.join(process.cwd(), 'public', 'pluginAssets', 'katex');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.cpSync(srcKatexDir, path.join(pluginDir, 'katex'), { recursive: true });
  }
};

export async function POST(req: NextRequest) {
  try {
    const { note_id } = await req.json();
    if (!note_id) {
      return NextResponse.json(
        { success: false, error: 'note_id is required' },
        { status: 400 }
      );
    }

    const note = Note.getNoteById(note_id);
    if (!note) {
      return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
    }

    const resourceDir = ViewerUtil.getResourceFolderPath();
    const tempDir = path.join(ViewerUtil.getProfileFolderPath(), 'tmp');
    const pluginDir = path.join(tempDir, 'joplin_web_viewer_plugin_assets');

    copyPluginAssetsIfNotExist(pluginDir);

    // joplin_resource:// を file:// の絶対パスに変換する
    const fileResourceDir = `file://${resourceDir}${path.sep === '\\' ? '' : '/'}`;

    let $ = cheerio.load(note.body || '');
    $ = ViewerUtil.modifyJoplinResource($, fileResourceDir);

    // headタグが存在しない場合は生成する
    if ($('head').length === 0) {
      $('html').prepend('<head></head>');
    }

    const katexCssPath = `file://${path.join(pluginDir, 'katex', 'katex.css')}`;
    $('head').append(`<link rel="stylesheet" href="${katexCssPath}">`);
    $('head').append(getBrowserNoteStyle());

    const htmlContent = $.html();

    // タイトルをファイル名として使えるようサニタイズ
    const safeTitle = (note.title || 'untitled').replace(/[/\\:*?"<>|]/g, '_');
    const htmlPath = path.join(tempDir, `${safeTitle}.html`);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');

    const url = `file://${htmlPath}`;
    return NextResponse.json({ success: true, url });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
