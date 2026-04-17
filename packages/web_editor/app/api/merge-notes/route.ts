import { NextRequest, NextResponse } from 'next/server';
import { Note } from '@/lib/note';
import { ViewerUtil } from '@/lib/viewerUtil';
import * as cheerio from 'cheerio';

/**
 * フォルダ配下のノートをマージしてHTMLを返す。
 * TOC要素(div.mce-toc)を各ノートから切り出し先頭にまとめる。
 *
 * GET /api/merge-notes?folder_id=<id>
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get('folder_id');
    if (!folderId) {
      return NextResponse.json(
        { success: false, error: 'folder_id query parameter is required' },
        { status: 400 }
      );
    }

    // フォルダ直下のノートをタイトル順で取得（bodyなし）
    const notesMeta = Note.getNotesByParentId(folderId);
    if (notesMeta.length === 0) {
      return new Response('<html><body><p>このフォルダにはノートがありません。</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const resourceDir = '/api/resource/';

    // 各ノートのbodyを変換して収集
    const processedBodies: string[] = [];
    const titles: string[] = [];

    for (const meta of notesMeta) {
      const note = Note.getNoteById(meta.id);
      if (!note) continue;

      let $ = cheerio.load(note.body || '');
      $ = ViewerUtil.modifyJoplinResource($, resourceDir);
      const linkModified = ViewerUtil.modifyJoplinLinkAnchor($);
      const dataRemoved = ViewerUtil.removeDataMceSrcAttr(linkModified);
      const body = dataRemoved('body').html() || '';
      processedBodies.push(body);
      titles.push(note.title || '');
    }

    // 全ボディを結合してからTOCを先頭にまとめる
    const mergedHtml = processedBodies.join('\n');
    const tocModifiedHtml = extractToCAndPutHead(mergedHtml, titles);

    // KaTeX CSSを付与（1回だけ）
    let $final = cheerio.load(tocModifiedHtml);
    $final = ViewerUtil.addKatexCssIfNotExists($final);

    return new Response($final.html(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * 各ノートのTOC要素(div.mce-toc)を抽出し、見出しを付けてbodyの先頭にまとめる。
 */
function extractToCAndPutHead(htmlBody: string, titles: string[]): string {
  const $ = cheerio.load(htmlBody);
  const grandParents: cheerio.Element[] = [];

  const tocs = $('div.mce-toc');
  for (let i = 0; i < tocs.length; i++) {
    const toc = tocs[i];
    const h2 = $(toc).find('h2');
    if (h2.length > 0) {
      $(h2).text(`目次: ${titles?.[i] ?? ''}`);
    }
    grandParents.push(toc);
  }

  // 逆順でbody先頭にprepend（元の順序を保つため）
  const reversedGrandParents = grandParents.reverse();
  reversedGrandParents.forEach((grandParent) => {
    $('body').prepend($(grandParent));
  });

  return $.html();
}
