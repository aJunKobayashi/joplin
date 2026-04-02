import { NextResponse } from 'next/server';
import { Note } from '@/lib/note';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query');
    if (!query) {
      return NextResponse.json(
        { success: false, error: 'query query parameter is required' },
        { status: 400 }
      );
    }

    const wildcardQuery = `${query}*`;
    const results = Note.selectAll(wildcardQuery);

    // Return only id and title, sorted by title
    const data = results
      .map((r) => ({ id: r.id, title: r.title }))
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ja'));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
