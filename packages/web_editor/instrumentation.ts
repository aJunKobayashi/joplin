export async function register() {
  // アプリケーション起動時に一度だけデータベースを初期化
  // Node.js 実行環境でのみ、Node 固有のモジュールを動的にインポートする
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const mod = await import('./lib/database');
      // getDatabase は同期関数なので await は不要だが呼び出しはここで行う
      mod.getDatabase();
      console.log('Application initialized: Database connection established');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }

    // stdio ベースの MCP サーバーを子プロセスとして事前起動する
    // これにより HTTP ポートなしで LangChain エージェントが利用できる
    try {
      const { getMcpClient, closeMcpClient } = await import('./lib/mcpClientSingleton');
      await getMcpClient();
      console.log('Application initialized: MCP stdio server started');

      // プロセス終了時（Ctrl+C / SIGTERM）に子プロセスを確実に閉じる
      const shutdown = () => {
        closeMcpClient().catch((e) => console.error('Failed to close MCP client:', e));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    } catch (error) {
      // MCP の起動失敗はアプリ全体を止めない（チャット機能だけ使えなくなる）
      console.error('Failed to start MCP stdio server:', error);
    }
  }
}
