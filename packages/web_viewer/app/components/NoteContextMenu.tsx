'use client';

import React, { useCallback } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';

export interface NoteContextMenuState {
  mouseX: number;
  mouseY: number;
  note: { id: string; title: string };
}

interface NoteContextMenuProps {
  state: NoteContextMenuState | null;
  onClose: () => void;
}

export function NoteContextMenu({ state, onClose }: NoteContextMenuProps) {
  const [viewFileDialog, setViewFileDialog] = React.useState<{ url: string; title: string } | null>(
    null
  );

  const handleViewAsFile = useCallback(async () => {
    if (state) {
      const noteTitle = state.note.title;
      const noteId = state.note.id;
      onClose();
      try {
        const res = await fetch('/api/note/view-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note_id: noteId }),
        });
        const json = await res.json();
        if (json.success && json.url) {
          setViewFileDialog({ url: json.url, title: noteTitle });
        }
      } catch {
        // ignore
      }
    } else {
      onClose();
    }
  }, [state, onClose]);

  const handleOpenHtml = useCallback(() => {
    if (state) {
      const url = `/api/note?id=${encodeURIComponent(state.note.id)}&format=html`;
      window.open(url, '_blank');
    }
    onClose();
  }, [state, onClose]);

  const handleCopyAsAnchor = useCallback(() => {
    if (state) {
      const href = `/note?note_id=${state.note.id}`;
      const anchor = `<a href="${href}">${state.note.title}</a>`;
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([anchor], { type: 'text/html' }),
          'text/plain': new Blob([anchor], { type: 'text/plain' }),
        }),
      ]);
    }
    onClose();
  }, [state, onClose]);

  return (
    <>
      <Menu
        open={state !== null}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={state !== null ? { top: state.mouseY, left: state.mouseX } : undefined}
      >
        <MenuItem onClick={handleOpenHtml}>HTMLを開く</MenuItem>
        <MenuItem onClick={handleViewAsFile}>fileスキームで見る</MenuItem>
        <MenuItem onClick={handleCopyAsAnchor}>リンクをa要素としてコピー</MenuItem>
      </Menu>

      <Dialog
        open={viewFileDialog !== null}
        onClose={() => setViewFileDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>fileスキームで開く — {viewFileDialog?.title}</DialogTitle>
        <DialogContent>
          <Box sx={{ wordBreak: 'break-all', mt: 1 }}>
            <a href={viewFileDialog?.url ?? ''} target="_blank" rel="noopener noreferrer">
              {viewFileDialog?.url}
            </a>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewFileDialog(null)}>閉じる</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
