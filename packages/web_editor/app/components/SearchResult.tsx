'use client';

import React, { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import DescriptionIcon from '@mui/icons-material/Description';
import Link from 'next/link';
import { useFolderQuery } from '@/lib/hooks';
import { FolderTreeNode, NoteTreeNode, TreeNode } from '@/lib/viewerUtil';
import { NoteEntity } from '@/lib/database';
import { NoteContextMenu, NoteContextMenuState } from './NoteContextMenu';

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

  const [noteContextMenu, setNoteContextMenu] = useState<NoteContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, note: { id: string; title: string }) => {
      if (!event.metaKey) return;
      event.preventDefault();
      setNoteContextMenu({ mouseX: event.clientX, mouseY: event.clientY, note });
    },
    []
  );

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
        <NoteContextMenu
          state={noteContextMenu}
          isEditor={isEditor}
          onClose={() => setNoteContextMenu(null)}
        />
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
      <NoteContextMenu
        state={noteContextMenu}
        isEditor={isEditor}
        onClose={() => setNoteContextMenu(null)}
      />
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
}
