'use client';

import React, { useRef, useCallback, useState } from 'react';
import { Tldraw, type Editor, getSnapshot, loadSnapshot, type TLEditorSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

interface TldrawDrawingDialogProps {
  open: boolean;
  onClose: () => void;
  /** 再編集時に復元するスナップショット（新規作成時は undefined） */
  initialSnapshot?: TLEditorSnapshot;
  /** SVG 文字列とスナップショットを受け取るコールバック */
  onSave: (svgString: string, snapshot: TLEditorSnapshot) => void;
}

export default function TldrawDrawingDialog({
  open,
  onClose,
  initialSnapshot,
  onSave,
}: TldrawDrawingDialogProps) {
  const editorRef = useRef<Editor | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      if (initialSnapshot) {
        // 既存スナップショットを復元（再編集）
        try {
          loadSnapshot(editor.store, initialSnapshot);
        } catch (err) {
          console.error('TldrawDrawingDialog: loadSnapshot failed', err);
        }
      }
    },
    // initialSnapshot はダイアログ open 時に固定される値なので deps に含める
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  const handleSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const shapeIds = [...editor.getCurrentPageShapeIds()];
    if (shapeIds.length === 0) {
      onClose();
      return;
    }

    setExporting(true);
    try {
      const [svgResult, snapshot] = await Promise.all([
        editor.getSvgString(shapeIds, { background: true }),
        Promise.resolve(getSnapshot(editor.store)),
      ]);
      if (svgResult?.svg) {
        onSave(svgResult.svg, snapshot);
      }
    } catch (err) {
      console.error('TldrawDrawingDialog: export failed', err);
    } finally {
      setExporting(false);
    }
  }, [onSave, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { height: '85vh', maxHeight: '85vh' } }}
    >
      <DialogTitle sx={{ pb: 0 }}>描画 (tldraw)</DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'hidden', position: 'relative', flex: 1 }}>
        {open && (
          <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
            <Tldraw onMount={handleMount} />
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          キャンセル
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={exporting}
          startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          挿入
        </Button>
      </DialogActions>
    </Dialog>
  );
}
