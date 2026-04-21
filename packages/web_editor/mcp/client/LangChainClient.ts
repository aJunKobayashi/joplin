import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Config } from '../../config.ts';
import { getMcpClient } from '../../lib/mcpClientSingleton';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

/**
 * 同じツールが複数回呼ばれた場合、古い呼び出し結果を除去して最新のみ残す。
 * LLMに送るメッセージが膨らむのを防ぎトークンを節約する。
 */
function deduplicateToolResults(messages: BaseMessage[]): BaseMessage[] {
  // tool_call_id → dedup key (tool_name + JSON args) のマッピングを構築
  // 引数が異なる呼び出し（例: get_markdown_content の異なる offset）は別扱いにする
  const callIdToKey = new Map<string, string>();
  for (const msg of messages) {
    if (msg instanceof AIMessage && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id) {
          const key = `${tc.name}::${JSON.stringify(tc.args ?? {})}`;
          callIdToKey.set(tc.id, key);
        }
      }
    }
  }

  // dedup key ごとに最後の ToolMessage インデックスを記録
  const latestByKey = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg instanceof ToolMessage) {
      const key = callIdToKey.get(msg.tool_call_id) ?? '';
      if (key) latestByKey.set(key, i);
    }
  }

  // 古い呼び出しの tool_call_id を収集
  const staleIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg instanceof ToolMessage) {
      const key = callIdToKey.get(msg.tool_call_id) ?? '';
      if (key && latestByKey.get(key) !== i) {
        staleIds.add(msg.tool_call_id);
      }
    }
  }

  if (staleIds.size === 0) return messages;

  const result: BaseMessage[] = [];
  for (const msg of messages) {
    // 古い ToolMessage は除去
    if (msg instanceof ToolMessage && staleIds.has(msg.tool_call_id)) continue;

    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      const kept = msg.tool_calls.filter((tc) => !staleIds.has(tc.id ?? ''));
      if (kept.length !== msg.tool_calls.length) {
        // tool_calls がすべて除去される場合はメッセージごと削除（contentもなければ）
        if (kept.length === 0 && !msg.content) continue;
        result.push(
          new AIMessage({
            content: msg.content,
            tool_calls: kept,
            id: msg.id,
            response_metadata: msg.response_metadata,
            additional_kwargs: msg.additional_kwargs,
          })
        );
        continue;
      }
    }
    result.push(msg);
  }
  return result;
}

class TokenCounter extends BaseCallbackHandler {
  name = 'token_counter';
  inputTokens = 0;
  outputTokens = 0;
  totalTokens = 0;
  callCount = 0;

  handleLLMEnd(output: LLMResult) {
    const usage = output.llmOutput?.tokenUsage;
    if (usage) {
      this.callCount++;
      const input = usage.promptTokens ?? 0;
      const out = usage.completionTokens ?? 0;
      const total = usage.totalTokens ?? 0;
      this.inputTokens += input;
      this.outputTokens += out;
      this.totalTokens += total;
      console.log(
        `[Token Usage #${this.callCount}] input: ${input}, output: ${out}, total: ${total}`
      );
    }
  }

  log() {
    console.log(
      `[Token Usage Total] input: ${this.inputTokens}, output: ${this.outputTokens}, total: ${this.totalTokens} (${this.callCount} calls)`
    );
  }
}

export interface ChatHistory {
  id: string;
  text: string;
  isUser: boolean;
  loading?: boolean;
}

export class LangChainClient {
  public static async sendMcpQuestion(
    message: string,
    systemPrompt?: string,
    histories: ChatHistory[] = []
  ): Promise<string> {
    // stdio シングルトンクライアントを利用（HTTP ポート不要）
    const mcp = await getMcpClient();
    const tools = await mcp.getTools();

    // Proxy設定
    const modelConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
      model: 'gpt-5.4-mini', // adjust if needed
      apiKey: process.env.JOPLIN_OAI_KEY,
    };

    if (Config.useProxy) {
      const proxyAgent = new ProxyAgent({
        uri: 'http://127.0.0.1:8082',
        requestTls: {
          rejectUnauthorized: false,
        },
      });
      modelConfig.configuration = {
        fetch: ((url: string, init?: object) => {
          return undiciFetch(url, { ...init, dispatcher: proxyAgent });
        }) as unknown as typeof globalThis.fetch,
      };
    }

    const tokenCounter = new TokenCounter();
    const model = new ChatOpenAI({ ...modelConfig, callbacks: [tokenCounter] });

    const agent = createReactAgent({
      llm: model,
      tools,
      messageModifier: deduplicateToolResults,
    });

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 会話履歴を追加
    for (const history of histories) {
      messages.push({
        role: history.isUser ? 'user' : 'assistant',
        content: history.text,
      });
    }

    // 現在のメッセージを追加
    messages.push({ role: 'user', content: message });

    const result = await agent.invoke({
      messages,
    });

    tokenCounter.log();

    // Extract the final AI reply content
    const msgs = Array.isArray(result?.messages) ? result.messages : [];
    const lastAi = msgs
      .slice()
      .reverse()
      .find((m) => {
        return (
          m &&
          (m.name === 'model' || m.type === 'ai' || String(m.constructor?.name).includes('AI')) &&
          m.content
        );
      });

    if (lastAi && lastAi.content) {
      console.log(lastAi.content);
      return String(lastAi.content);
    } else if (typeof result === 'string') {
      console.log(result);
      return result;
    } else {
      console.log(result);
      return JSON.stringify(result, null, 2);
    }
  }

  /**
   * chat/route.ts と同様のストリーミング版。
   * agent.stream() の streamMode:"messages" で AIMessageChunk を逐次 onToken に渡す。
   */
  public static async sendMcpQuestionStream(
    message: string,
    onToken: (token: string) => void,
    systemPrompt?: string,
    histories: ChatHistory[] = []
  ): Promise<void> {
    // stdio シングルトンクライアントを利用（HTTP ポート不要）
    const mcp = await getMcpClient();
    const tools = await mcp.getTools();

    const modelConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
      model: 'gpt-5.4-mini',
      apiKey: process.env.JOPLIN_OAI_KEY,
      streaming: true,
    };

    if (Config.useProxy) {
      const proxyAgent = new ProxyAgent({
        uri: 'http://127.0.0.1:8082',
        requestTls: { rejectUnauthorized: false },
      });
      modelConfig.configuration = {
        fetch: ((url: string, init?: object) => {
          return undiciFetch(url, { ...init, dispatcher: proxyAgent });
        }) as unknown as typeof globalThis.fetch,
      };
    }

    const tokenCounter = new TokenCounter();
    const model = new ChatOpenAI({ ...modelConfig, callbacks: [tokenCounter] });
    const agent = createReactAgent({
      llm: model,
      tools,
      messageModifier: deduplicateToolResults,
    });

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const history of histories) {
      messages.push({
        role: history.isUser ? 'user' : 'assistant',
        content: history.text,
      });
    }
    messages.push({ role: 'user', content: message });

    // streamMode: "messages" → [MessageLike, metadata] のタプルを逐次 yield
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: AsyncIterable<any> = await agent.stream({ messages }, { streamMode: 'messages' });

    for await (const chunk of stream) {
      // タプル形式 [message, metadata] の場合は先頭要素を取得
      const msg = Array.isArray(chunk) ? chunk[0] : chunk;
      if (!msg || !('content' in msg)) continue;

      // AIメッセージのみを対象とする（ToolMessageやHumanMessageは除外）
      // msg.type === 'tool' はツール実行結果（検索結果JSONなど）
      if (msg.type && msg.type !== 'ai') continue;

      // ツール呼び出しリクエスト（中間のAIメッセージ）はスキップ
      if (msg.tool_calls && msg.tool_calls.length > 0) continue;
      if (msg.tool_call_chunks && msg.tool_call_chunks.length > 0) continue;

      const content = msg.content;
      if (typeof content === 'string' && content) {
        onToken(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'string') {
            onToken(part);
          } else if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof part.text === 'string'
          ) {
            onToken(part.text);
          }
        }
      }
    }

    tokenCounter.log();

    await mcp.close();
  }
}

// LangChainClient.sendMcpQuestion().catch(console.error);
