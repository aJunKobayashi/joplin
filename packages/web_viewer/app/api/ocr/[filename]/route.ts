import { NextResponse } from 'next/server';
import { ViewerUtil } from '@/lib/viewerUtil';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

// Extensions natively supported by ndlocr-lite
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.jp2']);

type Props = {
  params: Promise<{
    filename: string;
  }>;
};

export async function GET(_req: Request, { params }: Props) {
  let tmpDir: string | null = null;
  try {
    const { filename } = await params;
    if (!filename) {
      return NextResponse.json({ success: false, error: 'filename is required' }, { status: 400 });
    }

    // strip query parameters and prevent path traversal
    const safeName = path.basename(filename.split('?')[0]);
    const resourceDir = ViewerUtil.getResourceFolderPath();
    const filePath = path.join(resourceDir, safeName);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    // create an isolated temp directory for this request
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ndlocr-'));

    // Convert to PNG if the format is not supported by ndlocr-lite
    const ext = path.extname(safeName).toLowerCase();
    let ocrInputPath: string;
    let ocrBaseName: string;
    if (SUPPORTED_EXTS.has(ext)) {
      ocrInputPath = filePath;
      ocrBaseName = path.basename(safeName, ext);
    } else {
      const convertedName = `${path.basename(safeName, ext)}.png`;
      ocrInputPath = path.join(tmpDir, convertedName);
      await sharp(filePath).png().toFile(ocrInputPath);
      ocrBaseName = path.basename(convertedName, '.png');
    }

    // run ndlocr-lite — execFile avoids shell injection; no shell metachar expansion
    await execFileAsync('ndlocr-lite', ['--sourceimg', ocrInputPath, '--output', tmpDir]);

    // ndlocr-lite writes <basename>.txt to the output directory
    let txtPath = path.join(tmpDir, `${ocrBaseName}.txt`);

    const txtStat = await fs.stat(txtPath).catch(() => null);
    if (!txtStat || !txtStat.isFile()) {
      // fallback: find any .txt file produced in the output directory
      const files = await fs.readdir(tmpDir);
      const txtFiles = files.filter((f) => f.endsWith('.txt'));
      if (txtFiles.length === 0) {
        return NextResponse.json(
          { success: false, error: 'OCR output file not found' },
          { status: 500 }
        );
      }
      txtPath = path.join(tmpDir, txtFiles[0]);
    }

    const text = await fs.readFile(txtPath, 'utf-8');
    return NextResponse.json({ success: true, text });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
