import { NextRequest, NextResponse } from 'next/server';
import { Folder } from '@/lib/folder';

export async function POST(req: NextRequest) {
  try {
    const { title, parent_id } = await req.json();
    if (!title || !parent_id) {
      return NextResponse.json(
        { success: false, error: 'title and parent_id are required' },
        { status: 400 }
      );
    }
    const folder = Folder.create(title, parent_id);
    return NextResponse.json({ success: true, data: folder });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
