'use client';

import React, { useRef, useCallback, useState } from 'react';
import { Tldraw, type Editor } from 'tldraw';
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
  /** SVG 文字列を受け取るコールバック */
  onSave: (svgString: string) => void;
}

export default function TldrawDrawingDialog({ open, onClose, onSave }: TldrawDrawingDialogProps) {
  const editorRef = useRef<Editor | null>(null);
  const [exporting, setExporting] = useState(false);

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
      const result = await editor.getSvgString(shapeIds, { background: true });
      if (result?.svg) {
        onSave(result.svg);
      }
    } catch (err) {
      console.error('TldrawDrawingDialog: SVG export failed', err);
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
            <Tldraw
              onMount={(editor) => {
                editorRef.current = editor;
              }}
            />
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
