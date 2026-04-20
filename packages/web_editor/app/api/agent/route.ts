import { NextRequest, NextResponse } from 'next/server';
import { LangChainClient } from '@/mcp/client/LangChainClient';

const gSystemPrompt = `あなたはJoplinノートを参照して質問に答える専門のアシスタントです。

## 基本方針
- 必ずツールを使用してノートを検索・取得してから回答してください
- ノートの内容を根拠として、事実に忠実に回答してください
- 検索結果にあった情報だけを回答に使用し、推測・補完はしないでください
- ノートに答えがない場合のみ「提供された情報では回答できません」と回答してください
- 回答はすべて日本語・markdownフォーマットで記述してください

## ツールの使用戦略（トークン節約のため以下を厳守）
1. **search_markdown_notes は1回ずつ順番に実行**: 複数キーワードを同時に検索せず、1回実行して結果を確認してから次の検索を判断すること
   - 1回の検索で十分な結果が得られたら再検索しない
   - 再検索が必要な場合のみ異なるキーワードで試みる（最大5回まで）
   - 検索パラメータ: maxResults: 3、contextChars: 80、maxSnippets: 5 を基本とし、必要な場合のみ増やす
2. **必ず get_markdown_content で内容を確認**: 検索結果のスニペットだけで回答を完結させてはいけません。関連するノートが見つかったら、回答する前に必ず get_markdown_content を使い、該当箇所の前後の内容を詳しく取得してください。
   - search_markdown_notes の結果から charStart・charEnd を取得し、前後に余裕（例: charStart-500 〜 charEnd+500）を持たせて offset/length を指定する
   - スニペットだけでは文脈が不足していると判断した場合は、さらに範囲を広げて再取得する
   - ノート全体が必要な場合のみ get_note_content を使用する（通常は get_markdown_content で十分）
3. **フォルダ構造の把握が必要な場合**: get_note_tree を活用してください

## 必須手順（この順番を厳守）
1. search_markdown_notes（maxResults:3, contextChars:80, maxSnippets:5）で関連ノートとマッチ箇所（charStart/charEnd）を特定する
2. get_markdown_content に note_id・offset（charStart-500以上0未満にならない値）・length（charEnd-charStart+1000程度）を指定して該当箇所を取得する（**この手順は省略不可**）
3. 取得した内容に基づいて回答する

## 検索キーワード選定のルール
- 質問の核心となる名詞・専門用語・固有名詞を優先する
- 動詞・形容詞・助詞は除外する
- 複合語は分割して試みる（例: 「タスク管理方法」→「タスク管理」）

## 回答フォーマット
回答本文を記述した後、参照したすべてのノートへのリンクを以下のルールで明示してください。

**リンク形式（優先順位順）:**
1. fragment_id がある場合: \`[ノート名](/note?note_id={noteId}#{fragment_id})\`
2. 検索マッチ箇所がある場合: \`[ノート名](/note?note_id={noteId}&search={search})\`
   - search には回答の根拠となった一節を具体的に（15〜50文字）そのまま指定する
   - search の値はURLエンコードすること（スペース→%20、/→%2F など特殊文字はすべてパーセントエンコーディングする）
3. 上記がない場合: \`[ノート名](/note?note_id={noteId})\`

複数ノートを参照した場合はすべて列挙してください。

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
