'use client';

import React, { useCallback, useImperativeHandle, useMemo, useTransition } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderIcon from '@mui/icons-material/Folder';
// FolderOpenIcon removed (unused)
import DescriptionIcon from '@mui/icons-material/Description';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { TreeNode, useFolderQuery } from '@/lib/hooks';

// fetch logic moved to `useFolderQuery` in `lib/hooks`
function renderTree(
  nodes: TreeNode[],
  onNoteClick?: () => void,
  currentNoteId?: string | null,
  onContextMenu?: (event: React.MouseEvent, node: TreeNode) => void
) {
  return nodes.map((node) => {
    if (node.type === 'Folder') {
      return (
        <TreeItem
          key={node.id}
          itemId={node.id}
          label={
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              onContextMenu={(e: React.MouseEvent) => onContextMenu?.(e, node)}
            >
              <FolderIcon fontSize="small" sx={{ color: '#F3C13A' }} />
              <span style={node.id === '__conflict__' ? { color: 'red' } : undefined}>
                {node.title}
              </span>
            </Box>
          }
        >
          {node.children &&
            node.children.length > 0 &&
            renderTree(node.children, onNoteClick, currentNoteId, onContextMenu)}
        </TreeItem>
      );
    }

    const isCurrentNote = node.id === currentNoteId;

    const box = (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          textDecoration: 'none',
          color: 'inherit',
        }}
        data-nodeid={node.id}
      >
        <DescriptionIcon fontSize="small" sx={{ color: 'rgba(0,0,0,0.6)' }} />
        <span>{node.title}</span>
      </Box>
    );
    // Note node (leaf)
    return (
      <TreeItem
        key={node.id}
        itemId={node.id}
        label={
          <Link
            href={`/note?note_id=${node.id}`}
            prefetch={false}
            onClick={
              isCurrentNote
                ? (e: React.MouseEvent) => {
                    e.preventDefault();
                  }
                : undefined
            }
            onContextMenu={(e: React.MouseEvent) => onContextMenu?.(e, node)}
          >
            {box}
          </Link>
        }
        onClick={onNoteClick}
      />
    );
  });
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

export interface NoteTreeHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

interface NoteTreeProps {
  isEditor?: boolean;
  ref?: React.Ref<NoteTreeHandle>;
}

function NoteTree({ isEditor, ref }: NoteTreeProps) {
  const { folders, isLoading, error } = useFolderQuery();
  const queryClient = useQueryClient();

  const searchParams = useSearchParams();
  const noteIdFromUrl = searchParams.get('note_id');
  const allFolderIds = React.useMemo(() => collectFolderIds(folders || []), [folders]);
  const [expandedItems, setExpandedItems] = React.useState<string[]>([]);
  const [isClicked, setIsClicked] = React.useState(false);
  const [, startTransition] = useTransition();

  // フォルダ読み込み完了時に全展開を初期状態とする
  React.useEffect(() => {
    if (allFolderIds.length > 0 && expandedItems.length === 0) {
      setExpandedItems(allFolderIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFolderIds]);

  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => startTransition(() => setExpandedItems(allFolderIds)),
      collapseAll: () => startTransition(() => setExpandedItems([])),
    }),
    [allFolderIds, startTransition]
  );

  const [contextMenu, setContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
    node: TreeNode;
  } | null>(null);

  const onClickNote = useCallback(() => {
    setIsClicked(true);
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent, node: TreeNode) => {
    if (!event.metaKey) return;
    event.preventDefault();
    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, node });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyAsAnchor = useCallback(() => {
    if (contextMenu) {
      const href = `/note?note_id=${contextMenu.node.id}`;
      const anchor = `<a href="${href}">${contextMenu.node.title}</a>`;
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
    if (contextMenu?.node.type === 'Note') {
      try {
        const res = await fetch(
          `/api/subpage-list?note_id=${encodeURIComponent(contextMenu.node.id)}`
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

  const [addNoteDialog, setAddNoteDialog] = React.useState<{ folderId: string } | null>(null);
  const [newNoteTitle, setNewNoteTitle] = React.useState('');

  const handleAddNoteOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      setAddNoteDialog({ folderId: contextMenu.node.id });
      setNewNoteTitle('');
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleAddNoteClose = useCallback(() => {
    setAddNoteDialog(null);
    setNewNoteTitle('');
  }, []);

  const handleAddNoteSubmit = useCallback(async () => {
    if (!addNoteDialog || !newNoteTitle.trim()) return;
    try {
      const res = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newNoteTitle.trim(), parent_id: addNoteDialog.folderId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setAddNoteDialog(null);
    setNewNoteTitle('');
  }, [addNoteDialog, newNoteTitle, queryClient]);

  const [renameDialog, setRenameDialog] = React.useState<{
    noteId: string;
    currentTitle: string;
  } | null>(null);
  const [renameTitle, setRenameTitle] = React.useState('');

  const handleRenameOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Note') {
      setRenameDialog({ noteId: contextMenu.node.id, currentTitle: contextMenu.node.title });
      setRenameTitle(contextMenu.node.title);
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

  // URLクエリパラメータのnote_idに対応するノートへスクロール＆フォーカス
  React.useEffect(() => {
    if (noteIdFromUrl && folders) {
      // TreeItemが描画されるまで少し待つ
      if (isClicked) {
        // When the note is changed by click, don't auto-scroll
        setIsClicked(false);
        return;
      }
      const timer = setTimeout(() => {
        const targetElement = document.querySelector(`[data-nodeid="${noteIdFromUrl}"]`);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // フォーカスを当てる（自動でクリックすると現在のクエリパラメータが上書きされるためクリックは行わない）
          const focusableElement = targetElement as HTMLElement;
          focusableElement.focus();
          const backupColor = focusableElement.style.backgroundColor;
          focusableElement.style.backgroundColor = 'rgba(135, 206, 250, 0.3)';
          setTimeout(() => {
            focusableElement.style.backgroundColor = backupColor;
          }, 10_000);
        }
      }, 1000);

      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIdFromUrl, folders]);

  const treeCompoent = useMemo(() => {
    return renderTree(folders || [], onClickNote, noteIdFromUrl, handleContextMenu);
  }, [folders, onClickNote, noteIdFromUrl, handleContextMenu]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Error loading folders: {error instanceof Error ? error.message : 'Unknown error'}
      </Alert>
    );
  }

  if (!folders || folders.length === 0) {
    return <Alert severity="info">No folders found</Alert>;
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Menu
        open={contextMenu !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        {contextMenu?.node.type === 'Note' && (
          <MenuItem onClick={handleCopyAsAnchor}>リンクをa要素としてコピー</MenuItem>
        )}
        {contextMenu?.node.type === 'Note' && (
          <MenuItem onClick={handleCopySubpageList}>サブページリスト</MenuItem>
        )}
        {contextMenu?.node.type === 'Note' && isEditor && (
          <MenuItem onClick={handleRenameOpen}>名前を変更</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleAddNoteOpen}>ノートを追加</MenuItem>
        )}
      </Menu>
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
      <Dialog open={addNoteDialog !== null} onClose={handleAddNoteClose}>
        <DialogTitle>ノートを追加</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="ノートのタイトル"
            fullWidth
            variant="outlined"
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddNoteSubmit();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAddNoteClose}>キャンセル</Button>
          <Button onClick={handleAddNoteSubmit} disabled={!newNoteTitle.trim()} variant="contained">
            追加
          </Button>
        </DialogActions>
      </Dialog>
      <SimpleTreeView
        aria-label="folder tree"
        slots={{
          collapseIcon: ExpandMoreIcon,
          expandIcon: ChevronRightIcon,
        }}
        sx={{ flex: 1, overflowY: 'auto' }}
        expandedItems={expandedItems}
        onExpandedItemsChange={(_e, ids) => setExpandedItems(ids)}
      >
        {treeCompoent}
      </SimpleTreeView>
    </Box>
  );
}

export default NoteTree;
