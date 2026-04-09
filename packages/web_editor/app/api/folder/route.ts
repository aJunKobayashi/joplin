import { NextRequest, NextResponse } from 'next/server';
import { Folder } from '@/lib/folder';

export async function PATCH(req: NextRequest) {
  try {
    const { id, title, parent_id } = await req.json();
    if (!id || (!title && !parent_id)) {
      return NextResponse.json(
        { success: false, error: 'id and at least one of title or parent_id are required' },
        { status: 400 }
      );
    }
    const existing = Folder.getFolderById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 });
    }
    if (title !== undefined) Folder.rename(id, title);
    if (parent_id !== undefined) Folder.move(id, parent_id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, parent_id } = await req.json();
    if (!title || parent_id === undefined || parent_id === null) {
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

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }
    const existing = Folder.getFolderById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 });
    }
    Folder.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
