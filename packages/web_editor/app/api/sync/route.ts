import { NextResponse } from 'next/server';
import { ViewerUtil } from '@/lib/viewerUtil';
import { runSync } from '@/scripts/sync_lib';

let isSyncing = false;

export async function POST() {
  if (isSyncing) {
    return NextResponse.json(
      { success: false, error: '同期が既に実行中です。しばらくお待ちください。' },
      { status: 409 }
    );
  }

  isSyncing = true;
  const profileDir = ViewerUtil.getProfileFolderPath();
  try {
    const stats = await runSync(profileDir);
    return NextResponse.json({ success: true, stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[sync API] Sync failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    isSyncing = false;
  }
}
