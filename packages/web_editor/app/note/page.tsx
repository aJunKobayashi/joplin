'use client';

import { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import NoteTreeWrapper from '../components/NoteTreeWrapper';
import ReactQueryProvider from '../components/ReactQueryProvider';
import NoteViewer from '../components/NoteViewer';
import NoteEditor from '../components/NoteEditor';
import { Switch, Typography, Paper } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import PreviewIcon from '@mui/icons-material/Preview';
import SyncButton from '../components/SyncButton';
import {
  ScrollAnchor,
  findVisibleAnchor,
  scrollToAnchorInViewer,
  scrollToAnchorInEditor,
} from '@/lib/scrollAnchor';

export default function NotePage() {
  const [mode, setMode] = useState<'viewer' | 'editor'>('viewer');

  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);

  /** Capture visible-element anchor from the current mode, then switch. */
  const handleModeSwitch = useCallback(() => {
    if (mode === 'viewer' && viewerContainerRef.current) {
      const contentRoot = viewerContainerRef.current.querySelector(
        '.note-content'
      ) as HTMLElement | null;
      if (contentRoot) {
        const top = viewerContainerRef.current.getBoundingClientRect().top;
        scrollAnchorRef.current = findVisibleAnchor(contentRoot, top);
      }
    } else if (mode === 'editor' && editorContainerRef.current) {
      const iframe = editorContainerRef.current.querySelector('iframe');
      const body = iframe?.contentDocument?.body as HTMLElement | undefined;
      if (body) {
        scrollAnchorRef.current = findVisibleAnchor(body, 0);
      }
    }
    setMode(mode === 'viewer' ? 'editor' : 'viewer');
  }, [mode]);

  /** After mode changes, scroll the new mode to the saved anchor. */
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;

    if (mode === 'viewer') {
      // Viewer renders quickly; wait a tick for the DOM to settle.
      const timer = setTimeout(() => {
        const container = viewerContainerRef.current;
        const contentRoot = container?.querySelector('.note-content') as HTMLElement | null;
        if (container && contentRoot) {
          scrollToAnchorInViewer(container, contentRoot, anchor);
        }
        scrollAnchorRef.current = null;
      }, 150);
      return () => clearTimeout(timer);
    }

    // Editor: TinyMCE initialises asynchronously. Poll for the iframe to be ready.
    let rafId: number;
    const start = Date.now();
    const poll = () => {
      if (Date.now() - start > 5000) {
        scrollAnchorRef.current = null;
        return;
      }
      const iframe = editorContainerRef.current?.querySelector('iframe');
      const body = iframe?.contentDocument?.body;
      const win = iframe?.contentWindow;
      if (body && win && body.children.length > 0 && body.innerHTML.length > 50) {
        // Give layout one more frame to settle after content is injected.
        setTimeout(() => {
          const b = iframe?.contentDocument?.body;
          const w = iframe?.contentWindow;
          if (b && w) scrollToAnchorInEditor(w, b, anchor);
          scrollAnchorRef.current = null;
        }, 200);
        return;
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  return (
    <ReactQueryProvider>
      <div className="h-screen">
        <Suspense>
          <Group orientation="horizontal">
            <Panel defaultSize={400} minSize={20} className="bg-gray-100 p-4 flex flex-col">
              <h2 className="text-lg font-bold mb-4">Folders</h2>
              <div className="flex-1 min-h-0 overflow-auto">
                <NoteTreeWrapper mode={mode} />
              </div>
              {mode === 'editor' && <SyncButton />}
            </Panel>
            <Separator className="w-2 bg-gray-300 hover:bg-gray-400 cursor-col-resize" />
            <Panel className="bg-white overflow-hidden relative">
              <Paper
                elevation={2}
                sx={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 50,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  bgcolor: 'background.paper',
                }}
              >
                <PreviewIcon
                  sx={{ fontSize: 18, color: mode === 'viewer' ? 'primary.main' : 'text.disabled' }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: mode === 'viewer' ? 'primary.main' : 'text.disabled',
                    fontWeight: mode === 'viewer' ? 700 : 400,
                  }}
                >
                  Viewer
                </Typography>
                <Switch
                  size="small"
                  checked={mode === 'editor'}
                  onChange={handleModeSwitch}
                  color="primary"
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: mode === 'editor' ? 'primary.main' : 'text.disabled',
                    fontWeight: mode === 'editor' ? 700 : 400,
                  }}
                >
                  Editor
                </Typography>
                <EditNoteIcon
                  sx={{ fontSize: 18, color: mode === 'editor' ? 'primary.main' : 'text.disabled' }}
                />
              </Paper>
              {mode === 'viewer' ? (
                <div ref={viewerContainerRef} className="w-full h-full overflow-auto p-4">
                  <NoteViewer />
                </div>
              ) : (
                <div ref={editorContainerRef} className="w-full h-full">
                  <NoteEditor />
                </div>
              )}
            </Panel>
          </Group>
        </Suspense>
      </div>
    </ReactQueryProvider>
  );
}
