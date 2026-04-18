/**
 * MCP stdio クライアントのシングルトン
 *
 * Web Editor プロセス内で一度だけ MultiServerMCPClient を生成し、
 * stdio 経由で mcp/server/stdio.ts を子プロセスとして起動します。
 * HTTP ポートを使わず、プロセス間パイプのみで通信します。
 *
 * instrumentation.ts がアプリ起動時に initMcpClient() を呼び出して
 * 子プロセスを事前起動します。LangChainClient はこのシングルトンを
 * 再利用するため、リクエストごとにプロセスを立ち上げ直す必要がありません。
 */

import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import path from 'path';

let _client: MultiServerMCPClient | null = null;

/** tsx バイナリのパス（node_modules/.bin/tsx）を解決する */
function getTsxPath(): string {
  return path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
}

/** stdio MCP クライアントのシングルトンを返す。初回呼び出し時に子プロセスを起動する。 */
export async function getMcpClient(): Promise<MultiServerMCPClient> {
  if (_client) return _client;

  const stdioServerPath = path.resolve(process.cwd(), 'mcp', 'server', 'stdio.ts');

  _client = new MultiServerMCPClient({
    joplinServer: {
      transport: 'stdio',
      command: getTsxPath(),
      args: [stdioServerPath],
      // 親プロセスの環境変数（DB パス等）を子プロセスに引き継ぐ
      env: { ...process.env } as Record<string, string>,
    },
  });

  // 接続を確立してツール一覧をキャッシュする
  await _client.getTools();

  return _client;
}

/** シングルトンを閉じる（プロセス終了時などに呼ぶ） */
export async function closeMcpClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}
