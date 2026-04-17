'use client';

import React, { useCallback, useImperativeHandle, useMemo, useTransition } from 'react';
import Link from 'next/link';
import {} from /* useQuery replaced by useFolderQuery */ '@tanstack/react-query';
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
import { TreeNode, useFolderQuery } from '@/lib/hooks';

// fetch logic moved to `useFolderQuery` in `lib/hooks`
function renderTree(
  nodes: TreeNode[],
  onNoteClick?: () => void,
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
              <span>{node.title}</span>
            </Box>
          }
        >
          {node.children && node.children.length > 0 && renderTree(node.children, onNoteClick, onContextMenu)}
        </TreeItem>
      );
    }

    // Note node (leaf)
    return (
      <TreeItem
        key={node.id}
        itemId={node.id}
        label={
          <Link
            href={`/note?note_id=${node.id}`}
            prefetch={false}
            onContextMenu={(e: React.MouseEvent) => onContextMenu?.(e, node)}
          >
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

const NoteTree = React.forwardRef<NoteTreeHandle>(function NoteTree(_, ref) {
  const { folders, isLoading, error } = useFolderQuery();

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

  const onClickNote = useCallback(() => {
    setIsClicked(true);
  }, []);

  const [contextMenu, setContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
    node: TreeNode;
  } | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent, node: TreeNode) => {
    if (!event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, node });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const [viewFileDialog, setViewFileDialog] = React.useState<{ url: string; title: string } | null>(null);

  const handleOpenHtml = useCallback(() => {
    if (contextMenu?.node.type === 'Note') {
      const url = `/api/note?id=${encodeURIComponent(contextMenu.node.id)}&format=html`;
      window.open(url, '_blank');
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleViewAsFile = useCallback(async () => {
    if (contextMenu?.node.type === 'Note') {
      const noteTitle = contextMenu.node.title;
      setContextMenu(null);
      try {
        const res = await fetch('/api/note/view-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note_id: contextMenu.node.id }),
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

  const handleMergeNotes = useCallback(() => {
    if (contextMenu?.node.type === 'Folder') {
      const url = `/api/merge-notes?folder_id=${encodeURIComponent(contextMenu.node.id)}`;
      window.open(url, '_blank');
    }
    setContextMenu(null);
  }, [contextMenu]);

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
    return renderTree(folders || [], onClickNote, handleContextMenu);
  }, [folders, onClickNote, handleContextMenu]);

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
          <MenuItem onClick={handleOpenHtml}>HTMLを開く</MenuItem>
        )}
        {contextMenu?.node.type === 'Note' && (
          <MenuItem onClick={handleViewAsFile}>fileスキームで見る</MenuItem>
        )}
        {contextMenu?.node.type === 'Folder' && (
          <MenuItem onClick={handleMergeNotes}>マージノートを開く</MenuItem>
        )}
      </Menu>
      <Dialog open={viewFileDialog !== null} onClose={() => setViewFileDialog(null)} maxWidth="sm" fullWidth>
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
});

export default NoteTree;
