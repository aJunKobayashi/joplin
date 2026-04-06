import { NextRequest, NextResponse } from 'next/server';
import { getSubpageListHTML } from '@/lib/subpageList';

export async function GET(request: NextRequest) {
  const noteId = request.nextUrl.searchParams.get('note_id');
  if (!noteId) {
    return NextResponse.json({ success: false, error: 'note_id is required' }, { status: 400 });
  }
  try {
    const html = getSubpageListHTML(noteId);
    return NextResponse.json({ success: true, html });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
