import { NextResponse } from 'next/server';
import { ViewerUtil } from '@/lib/viewerUtil';
import { Resource } from '@/lib/resource';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

type Props = {
  params: Promise<{
    filename: string;
  }>;
};

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export async function POST(_req: Request, { params }: Props) {
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    // prevent path traversal
    const safeName = path.basename(filename);
    const resourceDir = ViewerUtil.getResourceFolderPath();
    const srcPath = path.join(resourceDir, safeName);

    const stat = await fs.stat(srcPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const ext = path.extname(safeName).toLowerCase();
    const newResourceId = uuidv4().replace(/-/g, '');
    const newFilename = ext ? `${newResourceId}${ext}` : newResourceId;
    const destPath = path.join(resourceDir, newFilename);

    await fs.copyFile(srcPath, destPath);

    const newStat = await fs.stat(destPath);
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const fileExtension = ext.startsWith('.') ? ext.slice(1) : ext;

    Resource.save({
      id: newResourceId,
      title: newFilename,
      mime,
      filename: '',
      file_extension: fileExtension,
      size: newStat.size,
      created_time: Date.now(),
      updated_time: Date.now(),
    });

    return NextResponse.json({ success: true, filename: newFilename });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
