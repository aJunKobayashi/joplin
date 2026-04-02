'use client';

import React from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import DescriptionIcon from '@mui/icons-material/Description';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Link from 'next/link';
import { useFolderQuery } from '@/lib/hooks';
import { FolderTreeNode, NoteTreeNode, TreeNode } from '@/lib/viewerUtil';
import { NoteEntity } from '@/lib/database';

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

export default function SearchResult({ query, fts = false }: { query: string; fts?: boolean }) {
  const [results, setResults] = React.useState<NoteEntity[] | null>(null);
  const [ftsResults, setFtsResults] = React.useState<FtsResult[] | null>(null);
  const [ftsLoading, setFtsLoading] = React.useState(false);
  const [ftsError, setFtsError] = React.useState<string | null>(null);
  const { folders, isLoading, error } = useFolderQuery();

  React.useEffect(() => {
    if (fts) {
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
        <List>
          {ftsResults.map((r) => (
            <ListItem key={r.id} disablePadding>
              <Link href={`/note?note_id=${r.id}`} prefetch={false}>
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
      <List>
        {results.map((r) => (
          <ListItem key={r.id} disablePadding>
            <Link href={`/note?note_id=${r.id}`} prefetch={false}>
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
