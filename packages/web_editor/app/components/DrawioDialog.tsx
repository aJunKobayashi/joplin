'use client';

import React, { useRef, useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';

/**
 * draw.io 埋め込み URL。
 * - embed=1      : 埋め込みモード
 * - spin=1       : ローディングスピナーを表示
 * - proto=json   : JSON プロトコルで postMessage
 * - saveAndExit=1: "Save and Exit" ボタンを表示
 * - noExitBtn=1  : draw.io 側の別途 Exit ボタンを非表示にして誤閉鎖を防ぐ
 */
const DRAWIO_EMBED_URL =
  'https://embed.diagrams.net/?embed=1&spin=1&proto=json&saveAndExit=1&noExitBtn=1';

interface DrawioDialogProps {
  open: boolean;
  onClose: () => void;
  /** 再編集時に復元する draw.io XML（新規作成時は undefined） */
  initialXml?: string;
  /** SVG 文字列と draw.io XML を受け取るコールバック */
  onSave: (svgString: string, xml: string) => void;
}

export default function DrawioDialog({ open, onClose, initialXml, onSave }: DrawioDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  /**
   * save イベント受信後、export レスポンスを待機中かどうかを示すフラグ。
   * saveAndExit=1 では save → exit が連続して発火するため、
   * このフラグが true のとき exit ハンドラはダイアログを閉じない。
   */
  const pendingSaveRef = useRef(false);
  /** save イベントで受け取った draw.io XML を一時保持する。 */
  const pendingXmlRef = useRef<string>('');

  const sendMessage = (msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify(msg),
      'https://embed.diagrams.net'
    );
  };

  useEffect(() => {
    if (!open) {
      // ダイアログが閉じたら状態をリセット
      setLoading(true);
      setExporting(false);
      pendingSaveRef.current = false;
      pendingXmlRef.current = '';
      return;
    }

    const handleMessage = (evt: MessageEvent) => {
      // embed.diagrams.net からのメッセージのみ処理する
      if (evt.origin !== 'https://embed.diagrams.net') return;
      if (typeof evt.data !== 'string' || evt.data.length === 0) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (msg.event) {
        case 'init':
          // draw.io の初期化完了：新規・再編集問わず必ず load を送る（未送信だと draw.io が初期化待ちのまま止まる）
          setLoading(false);
          sendMessage({ action: 'load', xml: initialXml ?? '', autosave: 0 });
          break;

        case 'save': {
          // "Save and Exit" 押下時：SVG エクスポートをリクエストする
          const xml = (msg.xml as string) ?? '';
          pendingXmlRef.current = xml;
          pendingSaveRef.current = true;
          setExporting(true);
          sendMessage({
            action: 'export',
            format: 'svg',
            xml,
            spin: 'エクスポート中',
            border: 10,
          });
          break;
        }

        case 'export': {
          // SVG エクスポート完了：data URI をデコードして onSave に渡す
          const dataUri = (msg.data as string) ?? '';
          const base64 = dataUri.replace(/^data:image\/svg\+xml;base64,/, '');
          // atob() はバイナリ文字列(Latin-1)として復号するため、UTF-8の日本語が文字化けする。
          // TextDecoder で UTF-8 として正しく復号する。
          const binaryStr = atob(base64);
          const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
          const svgString = new TextDecoder('utf-8').decode(bytes);
          const xml = pendingXmlRef.current;
          pendingSaveRef.current = false;
          pendingXmlRef.current = '';
          setExporting(false);
          onSave(svgString, xml);
          break;
        }

        case 'exit':
          /**
           * saveAndExit=1 では save → exit が連続して発火する。
           * pendingSaveRef が true ならエクスポート待ち中なので無視する。
           * false なら（保存せず）閉じられたとみなしてダイアログを閉じる。
           */
          if (!pendingSaveRef.current) {
            onClose();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // initialXml はダイアログ open 時に固定される値なので deps に含める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{ sx: { height: '90vh', maxHeight: '90vh' } }}
    >
      <DialogTitle sx={{ pb: 0 }}>描画 (draw.io)</DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'hidden', position: 'relative', flex: 1 }}>
        {loading && (
          <Box
            sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}
          >
            <CircularProgress />
          </Box>
        )}
        {open && (
          <iframe
            ref={iframeRef}
            src={DRAWIO_EMBED_URL}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: loading ? 'none' : 'block',
            }}
            title="draw.io 描画エディタ"
          />
        )}
        {exporting && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.3)',
            }}
          >
            <CircularProgress color="inherit" />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          キャンセル
        </Button>
      </DialogActions>
    </Dialog>
  );
}
