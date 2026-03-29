import { NextResponse } from 'next/server';
import { ViewerUtil } from '@/lib/viewerUtil';
import { Resource } from '@/lib/resource';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

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

export async function GET(_req: Request, { params }: Props) {
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    // prevent path traversal
    const safeName = path.basename(filename);
    const resourceDir = ViewerUtil.getResourceFolderPath();
    const filePath = path.join(resourceDir, safeName);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const data = await fs.readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    const expires = new Date(Date.now() + 100 * 365.25 * 24 * 60 * 60 * 1000); // 100年キャッシュ
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3153600000, immutable',
        Expires: expires.toUTCString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request, { params }: Props) {
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    // prevent path traversal
    const safeName = path.basename(filename);
    const ext = path.extname(safeName).toLowerCase();
    const resourceId = uuidv4().replace(/-/g, '');
    const newFilename = ext ? `${resourceId}${ext}` : resourceId;

    const resourceDir = ViewerUtil.getResourceFolderPath();
    await fs.mkdir(resourceDir, { recursive: true });
    const filePath = path.join(resourceDir, newFilename);

    const buffer = await req.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));

    // ファイル書き込み後にメタデータを DB に保存（shim-init-node.js の Resource.save に相当）
    const stat = await fs.stat(filePath);
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const fileExtension = ext.startsWith('.') ? ext.slice(1) : ext;

    Resource.save({
      id: resourceId,
      title: safeName,
      mime,
      filename: '',
      file_extension: fileExtension,
      size: stat.size,
      created_time: Date.now(),
      updated_time: Date.now(),
    });

    return NextResponse.json({ success: true, filename: newFilename, originalName: safeName });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: Props) {
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const compress = body.compress === true;
    const targetWidth = parseInt(body.width ?? '0', 10) || 0;
    const maxSizeKB = parseInt(body.maxSizeKB ?? '0', 10) || 0;

    // prevent path traversal
    const safeName = path.basename(filename);
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const srcPath = path.join(homeDir, 'joplin_img', safeName);

    const srcStat = await fs.stat(srcPath).catch(() => null);
    if (!srcStat || !srcStat.isFile()) {
      return NextResponse.json(
        { success: false, error: `File not found in joplin_img: ${safeName}` },
        { status: 404 }
      );
    }

    const resourceDir = ViewerUtil.getResourceFolderPath();
    await fs.mkdir(resourceDir, { recursive: true });

    const resourceId = uuidv4().replace(/-/g, '');
    let newFilename: string;
    let outputMime: string;
    let outputExt: string;
    let fileData: Buffer;

    if (compress && targetWidth > 0) {
      // sharp でリサイズ + WebP 変換（maxSizeKB を超えないよう quality を下げて再試行）
      outputExt = '.webp';
      outputMime = 'image/webp';
      newFilename = `${resourceId}${outputExt}`;

      let quality = 85;
      let buf: Buffer;
      do {
        buf = await sharp(srcPath).resize({ width: targetWidth }).webp({ quality }).toBuffer();
        if (maxSizeKB <= 0 || buf.length <= maxSizeKB * 1024 || quality <= 20) break;
        quality -= 10;
      } while (quality > 0);
      fileData = buf!;
    } else {
      // 圧縮なし: そのままコピー
      const ext = path.extname(safeName).toLowerCase();
      outputExt = ext;
      outputMime = MIME_MAP[ext] || 'application/octet-stream';
      newFilename = ext ? `${resourceId}${ext}` : resourceId;
      fileData = await fs.readFile(srcPath);
    }

    const destPath = path.join(resourceDir, newFilename);
    await fs.writeFile(destPath, fileData);

    const fileExtension = outputExt.startsWith('.') ? outputExt.slice(1) : outputExt;
    Resource.save({
      id: resourceId,
      title: safeName,
      mime: outputMime,
      filename: '',
      file_extension: fileExtension,
      size: fileData.length,
      created_time: Date.now(),
      updated_time: Date.now(),
    });

    return NextResponse.json({ success: true, filename: newFilename, originalName: safeName });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: Props) {
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    // prevent path traversal
    const safeName = path.basename(filename);
    const resourceDir = ViewerUtil.getResourceFolderPath();
    const filePath = path.join(resourceDir, safeName);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    // ファイル削除・DB クリーンアップを Resource.delete に委譲
    const resourceId = path.basename(safeName, path.extname(safeName));
    await Resource.delete(resourceId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
