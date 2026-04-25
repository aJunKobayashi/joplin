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
import { TreeNode, useFolderQuery } from '@/lib/hooks';
import { NoteContextMenu, NoteContextMenuState } from './NoteContextMenu';

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
          {node.children &&
            node.children.length > 0 &&
            renderTree(node.children, onNoteClick, onContextMenu)}
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

interface NoteTreeProps {
  ref?: React.Ref<NoteTreeHandle>;
}

function NoteTree({ ref }: NoteTreeProps) {
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

  const [noteContextMenu, setNoteContextMenu] = React.useState<NoteContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
    node: TreeNode;
  } | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent, node: TreeNode) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if (isMac ? !event.metaKey : !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'Note') {
      setNoteContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        note: { id: node.id, title: node.title },
      });
    } else {
      setFolderContextMenu({ mouseX: event.clientX, mouseY: event.clientY, node });
    }
  }, []);

  const handleFolderContextMenuClose = useCallback(() => {
    setFolderContextMenu(null);
  }, []);

  const [rootContextMenu, setRootContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const handleRootContextMenu = useCallback((event: React.MouseEvent) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    if (isMac ? !event.metaKey : !event.ctrlKey) return;
    event.preventDefault();
    setRootContextMenu({ mouseX: event.clientX, mouseY: event.clientY });
  }, []);

  const handleRootContextMenuClose = useCallback(() => {
    setRootContextMenu(null);
  }, []);

  const handleMergeNotes = useCallback(() => {
    if (folderContextMenu?.node.type === 'Folder') {
      const url = `/api/merge-notes?folder_id=${encodeURIComponent(folderContextMenu.node.id)}`;
      window.open(url, '_blank');
    }
    setFolderContextMenu(null);
  }, [folderContextMenu]);

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
      <NoteContextMenu state={noteContextMenu} onClose={() => setNoteContextMenu(null)} />
      <Menu
        open={folderContextMenu !== null}
        onClose={handleFolderContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          folderContextMenu !== null
            ? { top: folderContextMenu.mouseY, left: folderContextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleMergeNotes}>マージノートを開く</MenuItem>
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
      ></Menu>
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
