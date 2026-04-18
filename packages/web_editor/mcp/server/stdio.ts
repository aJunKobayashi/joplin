/**
 * stdio ベースの MCP サーバー
 *
 * HTTP ポートを使わず、stdin/stdout でやり取りします。
 * Claude Desktop などのクライアントが自動的にこのプロセスを起動し、
 * パイプ経由でプロトコル通信を行います。
 *
 * 設定例 (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "joplin": {
 *       "command": "tsx",
 *       "args": ["/path/to/web_editor/mcp/server/stdio.ts"]
 *     }
 *   }
 * }
 *
 * Web Editor の LangChain エージェントからは、
 * lib/mcpClientSingleton.ts が自動的にこのスクリプトを起動します。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './tools';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // connect() 後に onmessage をラップしてリクエストをログ出力する
  // （stdout は MCP プロトコル専用なので stderr へ書く）
  const originalOnMessage = transport.onmessage;
  transport.onmessage = (message) => {
    console.error('[MCP stdio] Request:', JSON.stringify(message, null, 2));
    originalOnMessage?.(message);
  };
}

main().catch((err) => {
  // stdout は MCP プロトコル通信専用なので、エラーは stderr に出力する
  process.stderr.write(
    `[MCP stdio] Fatal error: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
