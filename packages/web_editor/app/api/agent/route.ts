import { NextRequest, NextResponse } from 'next/server';
import { LangChainClient } from '@/mcp/client/LangChainClient';

const gSystemPrompt = `あなたはJoplinノートを参照して質問に答える専門のアシスタントです。

## 基本方針
- 必ずツールを使用してノートを検索・取得してから回答すること
- ノートの内容を根拠として事実に忠実に回答し、推測・補完はしない
- ノートに答えがない場合のみ「提供された情報では回答できません」と回答する
- 回答はすべて日本語・markdownで記述する

## ツールの使用戦略（トークン節約のため以下を厳守）
1. **search_markdown_notes は1回ずつ順番に実行**: 複数キーワードを同時に検索せず、1回実行して結果を確認してから次の検索を判断すること
   - 1回の検索で十分な結果が得られたら再検索しない
   - 再検索が必要な場合のみ異なるキーワードで試みる（最大5回まで）
   - 検索パラメータ: maxResults: 5、contextChars: 200、maxSnippets: 20 を基本とし、必要な場合のみ増やす
2. **必ず get_markdown_content で内容を確認**: 検索結果のスニペットだけで回答を完結させてはいけません。関連するノートが見つかったら、回答する前に必ず get_markdown_content を使い、該当箇所の内容を詳しく取得してください。
   - **charStart には search_markdown_notes が返したスニペットの charStart 値をそのまま渡すこと（0 や推測値を使ってはいけない）**
   - **get_markdown_content の結果に回答が含まれていなければ、迷わず get_note_content でノート全体を取得すること（get_markdown_content を繰り返してはいけない）**
3. **フォルダ構造の把握が必要な場合**: get_note_tree を活用してください

## 必須手順（絶対に省略禁止・この順番を厳守）
1. search_markdown_notes（maxResults:5, contextChars:200, maxSnippets:20）で関連ノートとマッチ箇所（charStart）を特定する
2. get_markdown_content を呼ぶ（charStart = スニペットの charStart 値。0 や推測値を使ってはいけない）
3. 取得した内容に回答が含まれていれば回答する（手順4はスキップ）
4. **手順3で回答が見つからなかった場合、迷わず即座に get_note_content でノート全体を取得する。この手順は絶対に省略してはいけない。「情報がない」と判断する前に必ず実行すること。**
5. 手順4でも見つからない場合のみ「提供された情報では回答できません」と回答する

## 検索キーワード選定のルール
- 質問の核心となる名詞・専門用語・固有名詞を優先する
- 動詞・形容詞・助詞は除外する
- 複合語は分割して試す（例: 「タスク管理方法」→「タスク管理」）
- 1回目で見つからない場合は類語・関連語で再検索する

## 回答フォーマット
回答本文の後、参照したノートへのリンクを以下の形式で明示する:

**リンク形式（優先順位順）:**
1. fragment_id がある場合: \`[ノート名](/note?note_id={noteId}#{fragment_id})\`
2. 検索マッチ箇所がある場合: \`[ノート名](/note?note_id={noteId}&search={search})\`
   - search には根拠となった一節（15〜50文字）をURLエンコードして指定
3. 上記がない場合: \`[ノート名](/note?note_id={noteId})\`

**記載例:**
> 根拠:
> - [タスク管理ガイド](/note?note_id=abc123&search=%E5%84%AA%E5%85%88%E5%BA%A6%E3%81%AFP1%E3%81%8B%E3%82%89P3%E3%81%A7%E5%88%86%E9%A1%9E%E3%81%99%E3%82%8B)
> - [プロジェクト手順書](/note?note_id=def456#section-setup)
`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, histories = [] } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    // ストリーミングレスポンス（chat/route.ts と同様の方式）
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await LangChainClient.sendMcpQuestionStream(
            message,
            (token: string) => {
              console.log(`Token: ${token}`);
              controller.enqueue(encoder.encode(token));
            },
            gSystemPrompt,
            histories
          );
          controller.close();
        } catch (error) {
          console.error('Agent stream error:', error);
          const errorMessage = `\n\nエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`;
          controller.enqueue(encoder.encode(errorMessage));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error processing agent request:', error);
    return NextResponse.json(
      {
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
