'use client';

import React from 'react';
import NoteTree, { NoteTreeHandle } from './NoteTree';
import SearchResult from './SearchResult';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import MemoizedSearchDialog from './SearchDialog';
import ChatDialog from './ChatDialog';
import Tooltip from '@mui/material/Tooltip';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';

export default function NoteTreeWrapper() {
  const [query, setQuery] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');
  const [openSearchDialog, setOpenSearchDialog] = React.useState(false);
  const [openChatDialog, setOpenChatDialog] = React.useState(false);
  const hideTree = query && query.trim() !== '';
  const noteTreeRef = React.useRef<NoteTreeHandle>(null);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Cmd+P on mac (metaKey) or Ctrl+P on other platforms
      if ((e.metaKey || e.ctrlKey) && key === 'p') {
        if (e.shiftKey) {
          // Cmd+Shift+P / Ctrl+Shift+P for Chat Dialog
          e.preventDefault();
          setOpenChatDialog(true);
        } else {
          // Cmd+P / Ctrl+P for Search Dialog
          e.preventDefault();
          setOpenSearchDialog(true);
          // populate dialog input with current query
          setSearchInput(query);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [query]);

  const onClose = React.useCallback(() => {
    setOpenSearchDialog(false);
  }, []);

  const onCloseChatDialog = React.useCallback(() => {
    setOpenChatDialog(false);
  }, []);

  return (
    <div
      className="note-tree-wrapper"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
        <TextField
          variant="outlined"
          size="small"
          placeholder="検索..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              setQuery(searchInput);
            }
          }}
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: searchInput ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => {
                    setSearchInput('');
                    setQuery('');
                  }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
          inputProps={{ 'aria-label': 'Search notes' }}
        />
        <Tooltip title="全て開く">
          <IconButton size="small" onClick={() => noteTreeRef.current?.expandAll()}>
            <UnfoldMoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="全て閉じる">
          <IconButton size="small" onClick={() => noteTreeRef.current?.collapseAll()}>
            <UnfoldLessIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>

      <MemoizedSearchDialog
        open={openSearchDialog}
        onClose={onClose}
        initialSearchInput={searchInput}
        setQuery={setQuery}
      />

      <ChatDialog open={openChatDialog} onClose={onCloseChatDialog} />

      <div style={{ flex: 1, minHeight: 0, display: !hideTree ? 'none' : undefined }}>
        <SearchResult query={query} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: hideTree ? 'none' : undefined }}>
        <NoteTree ref={noteTreeRef} />
      </div>
    </div>
  );
}
