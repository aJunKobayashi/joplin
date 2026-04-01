'use client';

import React, { useCallback, useImperativeHandle, useMemo } from 'react';
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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

function collectIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.type === 'Folder' && node.children && node.children.length > 0) {
      ids.push(...collectIds(node.children));
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
  const allIds = React.useMemo(() => collectIds(folders || []), [folders]);
  const [expandedItems, setExpandedItems] = React.useState<string[]>([]);
  const [isClicked, setIsClicked] = React.useState(false);

  // フォルダ読み込み完了時に全展開を初期状態とする
  React.useEffect(() => {
    if (allIds.length > 0 && expandedItems.length === 0) {
      setExpandedItems(allIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds]);

  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => setExpandedItems(allIds),
      collapseAll: () => setExpandedItems([]),
    }),
    [allIds]
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
        <MenuItem onClick={handleCopyAsAnchor}>リンクをa要素としてコピー</MenuItem>
      </Menu>
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
