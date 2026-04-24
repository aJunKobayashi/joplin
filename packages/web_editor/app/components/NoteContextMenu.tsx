'use client';

import React, { useCallback } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import FolderIcon from '@mui/icons-material/Folder';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { TreeNode, useFolderQuery } from '@/lib/hooks';

export interface NoteContextMenuState {
  mouseX: number;
  mouseY: number;
  note: { id: string; title: string };
}

interface NoteContextMenuProps {
  state: NoteContextMenuState | null;
  isEditor?: boolean;
  onClose: () => void;
}

function renderFolderOnly(nodes: TreeNode[]): React.ReactNode[] {
  return nodes
    .filter((node) => node.type === 'Folder')
    .map((node) => (
      <TreeItem
        key={node.id}
        itemId={node.id}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderIcon fontSize="small" sx={{ color: '#F3C13A' }} />
            <span>{node.title}</span>
          </Box>
        }
      >
        {node.children &&
          node.children.some((c) => c.type === 'Folder') &&
          renderFolderOnly(node.children)}
      </TreeItem>
    ));
}

function collectFolderIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'Folder') {
      ids.push(node.id);
      if (node.children && node.children.length > 0) {
        ids.push(...collectFolderIds(node.children));
      }
    }
  }
  return ids;
}

export function NoteContextMenu({ state, isEditor, onClose }: NoteContextMenuProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { folders } = useFolderQuery();
  const allFolderIds = React.useMemo(() => collectFolderIds(folders || []), [folders]);

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

  const handleCopySubpageList = useCallback(async () => {
    if (state) {
      try {
        const res = await fetch(`/api/subpage-list?note_id=${encodeURIComponent(state.note.id)}`);
        const json = await res.json();
        if (json.success) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([json.html], { type: 'text/html' }),
              'text/plain': new Blob([json.html], { type: 'text/plain' }),
            }),
          ]);
        }
      } catch {
        // ignore
      }
    }
    onClose();
  }, [state, onClose]);

  // --- Rename ---
  const [renameDialog, setRenameDialog] = React.useState<{
    noteId: string;
    currentTitle: string;
  } | null>(null);
  const [renameTitle, setRenameTitle] = React.useState('');

  const handleRenameOpen = useCallback(() => {
    if (state) {
      setRenameDialog({ noteId: state.note.id, currentTitle: state.note.title });
      setRenameTitle(state.note.title);
    }
    onClose();
  }, [state, onClose]);

  const handleRenameClose = useCallback(() => {
    setRenameDialog(null);
    setRenameTitle('');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameDialog || !renameTitle.trim()) return;
    try {
      const res = await fetch('/api/note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renameDialog.noteId, title: renameTitle.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setRenameDialog(null);
    setRenameTitle('');
  }, [renameDialog, renameTitle, queryClient]);

  // --- Delete ---
  const [deleteDialog, setDeleteDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);

  const handleDeleteOpen = useCallback(() => {
    if (state) {
      setDeleteDialog({ noteId: state.note.id, noteTitle: state.note.title });
    }
    onClose();
  }, [state, onClose]);

  const handleDeleteClose = useCallback(() => {
    setDeleteDialog(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteDialog) return;
    try {
      const res = await fetch('/api/note', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteDialog.noteId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
        if (searchParams.get('note_id') === deleteDialog.noteId) {
          window.location.href = '/';
        }
      }
    } catch {
      // ignore
    }
    setDeleteDialog(null);
  }, [deleteDialog, queryClient, searchParams]);

  // --- Move ---
  const [moveDialog, setMoveDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string | null>(null);
  const [moveDialogExpanded, setMoveDialogExpanded] = React.useState<string[]>([]);

  const handleMoveOpen = useCallback(() => {
    if (state) {
      setMoveDialog({ noteId: state.note.id, noteTitle: state.note.title });
      setMoveTargetFolderId(null);
      setMoveDialogExpanded(allFolderIds);
    }
    onClose();
  }, [state, onClose, allFolderIds]);

  const handleMoveClose = useCallback(() => {
    setMoveDialog(null);
    setMoveTargetFolderId(null);
  }, []);

  const handleMoveConfirm = useCallback(async () => {
    if (!moveDialog || !moveTargetFolderId) return;
    try {
      const res = await fetch('/api/note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: moveDialog.noteId, parent_id: moveTargetFolderId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setMoveDialog(null);
    setMoveTargetFolderId(null);
  }, [moveDialog, moveTargetFolderId, queryClient]);

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
        <MenuItem onClick={handleCopySubpageList}>サブページリスト</MenuItem>
        {isEditor && <MenuItem onClick={handleRenameOpen}>名前を変更</MenuItem>}
        {isEditor && <MenuItem onClick={handleDeleteOpen}>ノートを削除</MenuItem>}
        {isEditor && <MenuItem onClick={handleMoveOpen}>ノートを移動</MenuItem>}
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

      <Dialog open={renameDialog !== null} onClose={handleRenameClose}>
        <DialogTitle>名前を変更</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="ノートのタイトル"
            fullWidth
            variant="outlined"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameClose}>キャンセル</Button>
          <Button onClick={handleRenameSubmit} disabled={!renameTitle.trim()} variant="contained">
            変更
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialog !== null} onClose={handleDeleteClose}>
        <DialogTitle>ノートを削除</DialogTitle>
        <DialogContent>
          <span>「{deleteDialog?.noteTitle}」を削除しますか？この操作は元に戻せません。</span>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteClose}>キャンセル</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            削除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={moveDialog !== null} onClose={handleMoveClose} maxWidth="xs" fullWidth>
        <DialogTitle>ノートを移動</DialogTitle>
        <DialogContent>
          <SimpleTreeView
            expandedItems={moveDialogExpanded}
            onExpandedItemsChange={(_e, ids) => setMoveDialogExpanded(ids)}
            selectedItems={moveTargetFolderId ?? ''}
            onSelectedItemsChange={(_e, id) =>
              setMoveTargetFolderId(typeof id === 'string' && id ? id : null)
            }
            slots={{ collapseIcon: ExpandMoreIcon, expandIcon: ChevronRightIcon }}
            sx={{ minHeight: 200, maxHeight: 400, overflowY: 'auto' }}
          >
            {renderFolderOnly(folders || [])}
          </SimpleTreeView>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleMoveClose}>キャンセル</Button>
          <Button onClick={handleMoveConfirm} disabled={!moveTargetFolderId} variant="contained">
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
