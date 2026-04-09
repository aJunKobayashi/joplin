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
import { FolderNode, TreeNode, useFolderQuery } from '@/lib/hooks';

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

function collectSubtreeIds(nodes: TreeNode[], targetId: string): Set<string> {
  const ids = new Set<string>();
  function gatherAll(node: TreeNode) {
    if (node.type === 'Folder') {
      ids.add(node.id);
      node.children?.forEach(gatherAll);
    }
  }
  function search(ns: TreeNode[]): boolean {
    for (const n of ns) {
      if (n.id === targetId) {
        gatherAll(n);
        return true;
      }
      if (n.type === 'Folder' && n.children && search(n.children)) return true;
    }
    return false;
  }
  search(nodes);
  return ids;
}

function renderFolderExcluding(nodes: TreeNode[], excludeIds: Set<string>): React.ReactNode[] {
  return nodes
    .filter((node): node is FolderNode => node.type === 'Folder' && !excludeIds.has(node.id))
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
          node.children.some(
            (c): c is FolderNode => c.type === 'Folder' && !excludeIds.has(c.id)
          ) &&
          renderFolderExcluding(node.children, excludeIds)}
      </TreeItem>
    ));
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
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, node });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const [rootContextMenu, setRootContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const handleRootContextMenu = useCallback((event: React.MouseEvent) => {
    if (!event.metaKey) return;
    event.preventDefault();
    setRootContextMenu({ mouseX: event.clientX, mouseY: event.clientY });
  }, []);

  const handleRootContextMenuClose = useCallback(() => {
    setRootContextMenu(null);
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

  const [deleteDialog, setDeleteDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);

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

  const handleDeleteOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Note') {
      setDeleteDialog({ noteId: contextMenu.node.id, noteTitle: contextMenu.node.title });
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleDeleteClose = useCallback(() => {
    setDeleteDialog(null);
  }, []);

  const searchParams2 = useSearchParams();
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
        // 削除したノートが現在表示中なら別ページへ遷移
        if (searchParams2.get('note_id') === deleteDialog.noteId) {
          window.location.href = '/';
        }
      }
    } catch {
      // ignore
    }
    setDeleteDialog(null);
  }, [deleteDialog, queryClient, searchParams2]);

  const [addRootFolderDialog, setAddRootFolderDialog] = React.useState<boolean>(false);
  const [newRootFolderTitle, setNewRootFolderTitle] = React.useState('');

  const [deleteFolderDialog, setDeleteFolderDialog] = React.useState<{
    folderId: string;
    folderTitle: string;
  } | null>(null);

  const handleDeleteFolderOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      setDeleteFolderDialog({ folderId: contextMenu.node.id, folderTitle: contextMenu.node.title });
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleDeleteFolderClose = useCallback(() => {
    setDeleteFolderDialog(null);
  }, []);

  const handleDeleteFolderConfirm = useCallback(async () => {
    if (!deleteFolderDialog) return;
    try {
      const res = await fetch('/api/folder', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteFolderDialog.folderId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setDeleteFolderDialog(null);
  }, [deleteFolderDialog, queryClient]);

  const handleAddRootFolderOpen = useCallback(() => {
    setAddRootFolderDialog(true);
    setNewRootFolderTitle('');
    setRootContextMenu(null);
  }, []);

  const handleAddRootFolderClose = useCallback(() => {
    setAddRootFolderDialog(false);
    setNewRootFolderTitle('');
  }, []);

  const handleAddRootFolderSubmit = useCallback(async () => {
    if (!newRootFolderTitle.trim()) return;
    try {
      const res = await fetch('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newRootFolderTitle.trim(), parent_id: '' }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setAddRootFolderDialog(false);
    setNewRootFolderTitle('');
  }, [newRootFolderTitle, queryClient]);

  const [addFolderDialog, setAddFolderDialog] = React.useState<{ parentId: string } | null>(null);
  const [newFolderTitle, setNewFolderTitle] = React.useState('');

  const [renameFolderDialog, setRenameFolderDialog] = React.useState<{
    folderId: string;
    currentTitle: string;
  } | null>(null);
  const [renameFolderTitle, setRenameFolderTitle] = React.useState('');

  const handleRenameFolderOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      setRenameFolderDialog({
        folderId: contextMenu.node.id,
        currentTitle: contextMenu.node.title,
      });
      setRenameFolderTitle(contextMenu.node.title);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleRenameFolderClose = useCallback(() => {
    setRenameFolderDialog(null);
    setRenameFolderTitle('');
  }, []);

  const handleRenameFolderSubmit = useCallback(async () => {
    if (!renameFolderDialog || !renameFolderTitle.trim()) return;
    try {
      const res = await fetch('/api/folder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renameFolderDialog.folderId, title: renameFolderTitle.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setRenameFolderDialog(null);
    setRenameFolderTitle('');
  }, [renameFolderDialog, renameFolderTitle, queryClient]);

  const handleAddFolderOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      setAddFolderDialog({ parentId: contextMenu.node.id });
      setNewFolderTitle('');
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleAddFolderClose = useCallback(() => {
    setAddFolderDialog(null);
    setNewFolderTitle('');
  }, []);

  const handleAddFolderSubmit = useCallback(async () => {
    if (!addFolderDialog || !newFolderTitle.trim()) return;
    try {
      const res = await fetch('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newFolderTitle.trim(), parent_id: addFolderDialog.parentId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setAddFolderDialog(null);
    setNewFolderTitle('');
  }, [addFolderDialog, newFolderTitle, queryClient]);

  const [moveDialog, setMoveDialog] = React.useState<{
    noteId: string;
    noteTitle: string;
  } | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string | null>(null);
  const [moveDialogExpanded, setMoveDialogExpanded] = React.useState<string[]>([]);

  const handleMoveOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Note') {
      setMoveDialog({ noteId: contextMenu.node.id, noteTitle: contextMenu.node.title });
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

  const [moveFolderDialog, setMoveFolderDialog] = React.useState<{
    folderId: string;
    folderTitle: string;
  } | null>(null);
  const [moveFolderTargetId, setMoveFolderTargetId] = React.useState<string | null>(null);
  const [moveFolderDialogExpanded, setMoveFolderDialogExpanded] = React.useState<string[]>([]);
  const [moveFolderExcludeIds, setMoveFolderExcludeIds] = React.useState<Set<string>>(new Set());

  const handleMoveFolderOpen = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      const excludeIds = collectSubtreeIds(folders || [], contextMenu.node.id);
      setMoveFolderDialog({ folderId: contextMenu.node.id, folderTitle: contextMenu.node.title });
      setMoveFolderTargetId(null);
      setMoveFolderExcludeIds(excludeIds);
      const allIds = allFolderIds.filter((id) => !excludeIds.has(id));
      setMoveFolderDialogExpanded(allIds);
    }
    setContextMenu(null);
  }, [contextMenu, folders, allFolderIds]);

  const handleMoveFolderClose = useCallback(() => {
    setMoveFolderDialog(null);
    setMoveFolderTargetId(null);
  }, []);

  const handleMoveFolderConfirm = useCallback(async () => {
    if (!moveFolderDialog || !moveFolderTargetId) return;
    try {
      const res = await fetch('/api/folder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: moveFolderDialog.folderId, parent_id: moveFolderTargetId }),
      });
      const json = await res.json();
      if (json.success) {
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      }
    } catch {
      // ignore
    }
    setMoveFolderDialog(null);
    setMoveFolderTargetId(null);
  }, [moveFolderDialog, moveFolderTargetId, queryClient]);

  // URLクエリパラメータのnote_idに対応するノードへスクロール＆フォーカス
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
        {contextMenu?.node.type === 'Note' && isEditor && (
          <MenuItem onClick={handleDeleteOpen}>ノートを削除</MenuItem>
        )}
        {contextMenu?.node.type === 'Note' && isEditor && (
          <MenuItem onClick={handleMoveOpen}>ノートを移動</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleAddNoteOpen}>ノートを追加</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleAddFolderOpen}>フォルダを追加</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleRenameFolderOpen}>名前を変更</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleMoveFolderOpen}>フォルダを移動</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && isEditor && (
          <MenuItem onClick={handleDeleteFolderOpen}>フォルダを削除</MenuItem>
        )}
      </Menu>
      <Menu
        open={rootContextMenu !== null}
        onClose={handleRootContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          rootContextMenu !== null
            ? { top: rootContextMenu.mouseY, left: rootContextMenu.mouseX }
            : undefined
        }
      >
        {isEditor && <MenuItem onClick={handleAddRootFolderOpen}>ルートにフォルダを追加</MenuItem>}
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
      <Dialog open={addFolderDialog !== null} onClose={handleAddFolderClose}>
        <DialogTitle>フォルダを追加</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="フォルダ名"
            fullWidth
            variant="outlined"
            value={newFolderTitle}
            onChange={(e) => setNewFolderTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddFolderSubmit();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAddFolderClose}>キャンセル</Button>
          <Button
            onClick={handleAddFolderSubmit}
            disabled={!newFolderTitle.trim()}
            variant="contained"
          >
            追加
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={renameFolderDialog !== null} onClose={handleRenameFolderClose}>
        <DialogTitle>フォルダ名を変更</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="フォルダ名"
            fullWidth
            variant="outlined"
            value={renameFolderTitle}
            onChange={(e) => setRenameFolderTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameFolderSubmit();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameFolderClose}>キャンセル</Button>
          <Button
            onClick={handleRenameFolderSubmit}
            disabled={!renameFolderTitle.trim()}
            variant="contained"
          >
            変更
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={deleteFolderDialog !== null} onClose={handleDeleteFolderClose}>
        <DialogTitle>フォルダを削除</DialogTitle>
        <DialogContent>
          <span>
            「{deleteFolderDialog?.folderTitle}
            」とその配下のフォルダ・ノートを削除しますか？この操作は元に戻せません。
          </span>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteFolderClose}>キャンセル</Button>
          <Button onClick={handleDeleteFolderConfirm} color="error" variant="contained">
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
      <Dialog
        open={moveFolderDialog !== null}
        onClose={handleMoveFolderClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>フォルダを移動</DialogTitle>
        <DialogContent>
          <SimpleTreeView
            expandedItems={moveFolderDialogExpanded}
            onExpandedItemsChange={(_e, ids) => setMoveFolderDialogExpanded(ids)}
            selectedItems={moveFolderTargetId ?? ''}
            onSelectedItemsChange={(_e, id) =>
              setMoveFolderTargetId(typeof id === 'string' && id ? id : null)
            }
            slots={{ collapseIcon: ExpandMoreIcon, expandIcon: ChevronRightIcon }}
            sx={{ minHeight: 200, maxHeight: 400, overflowY: 'auto' }}
          >
            {renderFolderExcluding(folders || [], moveFolderExcludeIds)}
          </SimpleTreeView>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleMoveFolderClose}>キャンセル</Button>
          <Button
            onClick={handleMoveFolderConfirm}
            disabled={!moveFolderTargetId}
            variant="contained"
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={addRootFolderDialog} onClose={handleAddRootFolderClose}>
        <DialogTitle>ルートにフォルダを追加</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="フォルダ名"
            fullWidth
            variant="outlined"
            value={newRootFolderTitle}
            onChange={(e) => setNewRootFolderTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddRootFolderSubmit();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAddRootFolderClose}>キャンセル</Button>
          <Button
            onClick={handleAddRootFolderSubmit}
            disabled={!newRootFolderTitle.trim()}
            variant="contained"
          >
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
        onContextMenu={handleRootContextMenu}
      >
        {treeCompoent}
      </SimpleTreeView>
    </Box>
  );
}

export default NoteTree;
