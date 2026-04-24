'use client';

import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderIcon from '@mui/icons-material/Folder';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useFolderQuery } from '@/lib/hooks';
import { FolderTreeNode, NoteTreeNode, TreeNode } from '@/lib/viewerUtil';
import { NoteEntity } from '@/lib/database';

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

const searchMatchedNotes = (query: string, folders: TreeNode[]): NoteEntity[] => {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];

  const results: NoteEntity[] = [];
  const seen = new Set<string>();

  const traverse = (nodes: TreeNode[] | undefined) => {
    if (!nodes || nodes.length === 0) return;
    for (const node of nodes) {
      if ((node as NoteTreeNode).type === 'Note') {
        const noteNode = node as NoteTreeNode;
        const title = (noteNode.title || '').toLowerCase();
        if (title.includes(q)) {
          const id = noteNode.metadata?.id || noteNode.id;
          if (!seen.has(id) && noteNode.metadata) {
            results.push(noteNode.metadata);
            seen.add(id);
          }
        }
      } else {
        // Folder node: recurse into children
        const folderNode = node as FolderTreeNode;
        traverse(folderNode.children);
      }
    }
  };

  traverse(folders);
  return results;
};

interface FtsResult {
  id: string;
  title: string;
}

export default function SearchResult({
  query,
  fts = false,
  isEditor,
}: {
  query: string;
  fts?: boolean;
  isEditor?: boolean;
}) {
  const [results, setResults] = React.useState<NoteEntity[] | null>(null);
  const [ftsResults, setFtsResults] = React.useState<FtsResult[] | null>(null);
  const [ftsLoading, setFtsLoading] = React.useState(false);
  const [ftsError, setFtsError] = React.useState<string | null>(null);
  const { folders, isLoading, error } = useFolderQuery();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const allFolderIds = React.useMemo(() => collectFolderIds(folders || []), [folders]);

  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    note: { id: string; title: string };
  } | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, note: { id: string; title: string }) => {
      if (!event.metaKey) return;
      event.preventDefault();
      setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, note });
    },
    []
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const [viewFileDialog, setViewFileDialog] = React.useState<{ url: string; title: string } | null>(
    null
  );

  const handleViewAsFile = useCallback(async () => {
    if (contextMenu) {
      const noteTitle = contextMenu.note.title;
      const noteId = contextMenu.note.id;
      setContextMenu(null);
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
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleOpenHtml = useCallback(() => {
    if (contextMenu) {
      const url = `/api/note?id=${encodeURIComponent(contextMenu.note.id)}&format=html`;
      window.open(url, '_blank');
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopyAsAnchor = useCallback(() => {
    if (contextMenu) {
      const href = `/note?note_id=${contextMenu.note.id}`;
      const anchor = `<a href="${href}">${contextMenu.note.title}</a>`;
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([anchor], { type: 'text/html' }),
          'text/plain': new Blob([anchor], { type: 'text/plain' }),
        }),
      ]);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopySubpageList = useCallback(async () => {
    if (contextMenu) {
      try {
        const res = await fetch(
          `/api/subpage-list?note_id=${encodeURIComponent(contextMenu.note.id)}`
        );
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
    setContextMenu(null);
  }, [contextMenu]);

  const [renameDialog, setRenameDialog] = React.useState<{
    noteId: string;
    currentTitle: string;
  } | null>(null);
  const [renameTitle, setRenameTitle] = React.useState('');

  const handleRenameOpen = useCallback(() => {
    if (contextMenu) {
      setRenameDialog({ noteId: contextMenu.note.id, currentTitle: contextMenu.note.title });
      setRenameTitle(contextMenu.note.title);
    }
    setContextMenu(null);
  }, [contextMenu]);

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

  const [deleteDialog, setDeleteDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);

  const handleDeleteOpen = useCallback(() => {
    if (contextMenu) {
      setDeleteDialog({ noteId: contextMenu.note.id, noteTitle: contextMenu.note.title });
    }
    setContextMenu(null);
  }, [contextMenu]);

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

  const [moveDialog, setMoveDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string | null>(null);
  const [moveDialogExpanded, setMoveDialogExpanded] = React.useState<string[]>([]);

  const handleMoveOpen = useCallback(() => {
    if (contextMenu) {
      setMoveDialog({ noteId: contextMenu.note.id, noteTitle: contextMenu.note.title });
      setMoveTargetFolderId(null);
      setMoveDialogExpanded(allFolderIds);
    }
    setContextMenu(null);
  }, [contextMenu, allFolderIds]);

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

  React.useEffect(() => {
    if (fts) {
      // FTS mode: fetch from API
      if (!query || query.trim() === '') {
        setFtsResults(null);
        setFtsError(null);
        return;
      }
      let cancelled = false;
      setFtsLoading(true);
      setFtsError(null);
      fetch(`/api/fts?query=${encodeURIComponent(query)}`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          if (json.success) {
            setFtsResults(json.data);
          } else {
            setFtsError(json.error || 'Unknown error');
          }
        })
        .catch((err) => {
          if (!cancelled) setFtsError(err.message);
        })
        .finally(() => {
          if (!cancelled) setFtsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    } else {
      // Normal mode: client-side tree search
      if (!query || query.trim() === '') {
        setResults(null);
        return;
      }
      if (!folders) {
        setResults([]);
        return;
      }
      const result = searchMatchedNotes(query, folders);
      setResults(result);
    }
  }, [query, folders, fts]);

  if (fts) {
    if (ftsLoading)
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
        </Box>
      );
    if (ftsError) return <Alert severity="error">{ftsError}</Alert>;
    if (!ftsResults || ftsResults.length === 0) return <Alert severity="info">No results</Alert>;

    return (
      <Box sx={{ height: '100%', overflowY: 'auto' }}>
        {renderContextMenu()}
        {renderDialogs()}
        <List>
          {ftsResults.map((r) => (
            <ListItem key={r.id} disablePadding>
              <Link
                href={`/note?note_id=${r.id}`}
                prefetch={false}
                onContextMenu={(e) => handleContextMenu(e, r)}
              >
                <ListItemButton>
                  <ListItemIcon>
                    <DescriptionIcon />
                  </ListItemIcon>
                  <ListItemText primary={r.title || '(no title)'} />
                </ListItemButton>
              </Link>
            </ListItem>
          ))}
        </List>
      </Box>
    );
  }

  if (isLoading)
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (!results || results.length === 0) return <Alert severity="info">No results</Alert>;

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      {renderContextMenu()}
      {renderDialogs()}
      <List>
        {results.map((r) => (
          <ListItem key={r.id} disablePadding>
            <Link
              href={`/note?note_id=${r.id}`}
              prefetch={false}
              onContextMenu={(e) => handleContextMenu(e, r)}
            >
              <ListItemButton>
                <ListItemIcon>
                  <DescriptionIcon />
                </ListItemIcon>
                <ListItemText primary={r.title || '(no title)'} />
              </ListItemButton>
            </Link>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  function renderContextMenu() {
    return (
      <Menu
        open={contextMenu !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={handleOpenHtml}>HTMLを開く</MenuItem>
        <MenuItem onClick={handleViewAsFile}>fileスキームで見る</MenuItem>
        <MenuItem onClick={handleCopyAsAnchor}>リンクをa要素としてコピー</MenuItem>
        <MenuItem onClick={handleCopySubpageList}>サブページリスト</MenuItem>
        {isEditor && <MenuItem onClick={handleRenameOpen}>名前を変更</MenuItem>}
        {isEditor && <MenuItem onClick={handleDeleteOpen}>ノートを削除</MenuItem>}
        {isEditor && <MenuItem onClick={handleMoveOpen}>ノートを移動</MenuItem>}
      </Menu>
    );
  }

  function renderDialogs() {
    return (
      <>
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
}
