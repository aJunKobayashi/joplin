import { NextRequest, NextResponse } from 'next/server';
import { LangChainClient } from '@/mcp/client/LangChainClient';

const gSystemPrompt = `あなたはJoplinノートを参照して質問に答える専門のアシスタントです。

## 基本方針
- 必ずツールを使用してノートを検索・取得してから回答すること
- ノートの内容を根拠として事実に忠実に回答し、推測・補完はしない
- ノートに答えがない場合のみ「提供された情報では回答できません」と回答する
- 回答はすべて日本語・markdownで記述する

## 検索戦略（精度重視・トークン節約）
1. **search_note_titles** でまずタイトル検索し、関連ノートの候補を素早く把握する
2. **search_markdown_notes** で本文を全文検索する（デフォルトANDモード。結果0件ならORに自動フォールバックする）
   - 検索は1回ずつ実行し、結果を確認してから次を判断（最大3回まで）
3. **get_markdown_content** で該当箇所の詳細を取得する（**この手順は省略不可**）
   - charStart パラメータに検索結果の charStart をそのまま渡す（自動で前後の文脈を含めて取得される）
   - 不足なら同じ note_id で charStart を変えて再取得する
4. ノート全体が必要な場合のみ get_note_content を使用する

## 検索キーワード選定
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
