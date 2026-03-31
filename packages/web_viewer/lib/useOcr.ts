import { useState } from 'react';

export type OcrState = {
  showOcrDialog: boolean;
  ocrText: string;
  ocrLoading: boolean;
  setOcrText: (text: string) => void;
  closeOcrDialog: () => void;
  runOcr: (filename: string) => void;
};

export function useOcr(): OcrState {
  const [showOcrDialog, setShowOcrDialog] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);

  const runOcr = (filename: string) => {
    setOcrText('');
    setOcrLoading(true);
    setShowOcrDialog(true);
    fetch(`/api/ocr/${encodeURIComponent(filename)}`)
      .then((res) => res.json())
      .then((json) => {
        setOcrText(json.success ? json.text : `エラー: ${json.error}`);
      })
      .catch((err) => {
        setOcrText(`エラー: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setOcrLoading(false));
  };

  const closeOcrDialog = () => setShowOcrDialog(false);

  return { showOcrDialog, ocrText, ocrLoading, setOcrText, closeOcrDialog, runOcr };
}
