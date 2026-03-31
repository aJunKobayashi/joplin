'use client';

import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';

type Props = {
  open: boolean;
  loading: boolean;
  text: string;
  onTextChange: (text: string) => void;
  onClose: () => void;
};

export default function OcrDialog({ open, loading, text, onTextChange, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>OCR 結果</DialogTitle>
      <DialogContent>
        {loading ? (
          <DialogContentText sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            OCR 処理中...
          </DialogContentText>
        ) : (
          <TextField
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            multiline
            fullWidth
            minRows={6}
            maxRows={20}
            variant="outlined"
            sx={{ fontFamily: 'monospace', mt: 1 }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => navigator.clipboard.writeText(text)} disabled={loading || !text}>
          コピー
        </Button>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
