import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ViewerUtil } from '../../lib/viewerUtil';
import { Note } from '@/lib/note';
import { Folder } from '@/lib/folder';
import TurndownService from 'turndown';

// UTF-8 バイトオフセット → JS 文字列インデックス のマッピングを構築
export function buildByteToCharMap(text: string): number[] {
  const encoder = new TextEncoder();
  const map: number[] = [];
  let bytePos = 0;
  let charPos = 0;
  while (charPos < text.length) {
    const codePoint = text.codePointAt(charPos)!;
    const charByteLen = encoder.encode(String.fromCodePoint(codePoint)).length;
    for (let b = 0; b < charByteLen; b++) {
      map[bytePos + b] = charPos;
    }
    bytePos += charByteLen;
    charPos += codePoint > 0xffff ? 2 : 1;
  }
  map[bytePos] = text.length;
  return map;
}

/** フォルダIDからフォルダ名へのマップを構築 */
function buildFolderNameMap(): Record<string, string> {
  const folders = Folder.getAllFolders();
  const map: Record<string, string> = {};
  for (const f of folders) {
    map[f.id] = f.title;
  }
  return map;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'Demo',
    version: '1.0.0',
  });

  server.registerTool(
    'get_note_tree',
    {
      description: 'Get folders and notes as a tree structure',
      inputSchema: z.object({}),
    },
    async () => {
      const tree = ViewerUtil.selectFolderAndNotesAndCreateTree();
      const simpleTree = ViewerUtil.simpleTreeNodes(tree);
      return {
        content: [{ type: 'text', text: JSON.stringify(simpleTree) }],
      };
    }
  );

  server.registerTool(
    'get_note_content',
    {
      description: 'Get the content of a specific note',
      inputSchema: z.object({
        noteId: z.string().describe('The ID of the note'),
        offset: z.number().describe('The offset to start reading the note content from').optional(),
        length: z.number().describe('The length of the content to read').optional(),
      }),
    },
    async ({ noteId, offset, length }) => {
      const content = Note.getNoteById(noteId);
      if (!content) {
        return {
          content: [{ type: 'text', text: '' }],
        };
      }

      let bodyText = content.body ?? '';

      if (bodyText) {
        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
        });
        bodyText = turndownService.turndown(bodyText);
      }

      if (offset !== undefined && length !== undefined) {
        const text = bodyText.slice(offset, offset + length);
        return {
          content: [{ type: 'text', text }],
        };
      }
      return {
        content: [{ type: 'text', text: bodyText }],
      };
    }
  );

  server.registerTool(
    'search_markdown_notes',
    {
      description:
        'Full-text search over markdown_notes. Returns snippets with charStart/charEnd for get_markdown_content. By default uses AND logic (all terms must match). Set matchMode to "OR" to broaden.',
      inputSchema: z.object({
        query: z.string().describe('Search keyword(s). Multiple words are AND-joined by default.'),
        matchMode: z
          .enum(['AND', 'OR'])
          .describe('AND: all terms must match (default, precise). OR: any term matches (broad).')
          .optional(),
        maxResults: z
          .number()
          .describe('Maximum number of notes to return (default: 5)')
          .optional(),
        contextChars: z
          .number()
          .describe('Characters before/after each match (default: 100)')
          .optional(),
        maxSnippets: z.number().describe('Maximum snippets to return (default: 20)').optional(),
        snippetsOffset: z.number().describe('Offset of snippets to return (default: 0)').optional(),
      }),
    },
    async ({ query, matchMode, maxResults, contextChars, maxSnippets, snippetsOffset }) => {
      const CONTEXT = contextChars ?? 100;
      const BODY_COL = 2; // markdown_notes_fts 列順: 0=id(notindexed), 1=title, 2=body
      const MAX_RESULTS = maxResults ?? 5;
      const MAX_SNIPPETS = maxSnippets ?? 20;
      const mode = matchMode ?? 'AND';
      try {
        // AND モードで検索し、結果が0件ならORにフォールバック
        let searchResults = Note.selectAllMarkdownFtsByMode(query, mode);
        let usedMode = mode;
        if (searchResults.length === 0 && mode === 'AND') {
          searchResults = Note.selectAllMarkdownFtsByMode(query, 'OR');
          usedMode = 'OR';
        }

        const folderMap = buildFolderNameMap();

        // ランキング: タイトルにマッチした場合にボーナスを付与
        const queryTerms = query
          .split(/[\s\u3000]+/)
          .filter(Boolean)
          .map((t) => t.toLowerCase());
        const ranked = [...searchResults].sort((a, b) => {
          const titleA = (a.title ?? '').toLowerCase();
          const titleB = (b.title ?? '').toLowerCase();
          const titleMatchA = queryTerms.filter((t) => titleA.includes(t)).length;
          const titleMatchB = queryTerms.filter((t) => titleB.includes(t)).length;
          // タイトルマッチ数で優先、同点ならオフセット数（=本文マッチ数）
          if (titleMatchB !== titleMatchA) return titleMatchB - titleMatchA;
          const countA = a.offsets ? Math.floor(a.offsets.split(' ').length / 4) : 0;
          const countB = b.offsets ? Math.floor(b.offsets.split(' ').length / 4) : 0;
          return countB - countA;
        });
        const limited = ranked.slice(0, MAX_RESULTS);
        const ids = limited.map((r) => r.id);
        const notes = Note.markdownByIds(ids);
        const noteMap: Record<string, (typeof notes)[0]> = {};
        for (const n of notes) {
          noteMap[n.id] = n;
        }

        const results = limited.flatMap((r) => {
          const note = noteMap[r.id];
          const body = note?.body ?? '';
          const folderName = r.parent_id ? (folderMap[r.parent_id] ?? '') : '';
          if (!body) return [];

          if (!r.offsets) {
            return [
              {
                note_id: r.id,
                note_title: r.title,
                folder_name: folderName,
                text: body.slice(0, CONTEXT * 2),
              },
            ];
          }

          const nums = r.offsets.split(' ').map(Number);
          const bodyOffsets: { byteOffset: number; byteLen: number }[] = [];
          for (let i = 0; i + 3 < nums.length; i += 4) {
            if (nums[i] === BODY_COL) {
              bodyOffsets.push({ byteOffset: nums[i + 2], byteLen: nums[i + 3] });
            }
          }

          if (bodyOffsets.length === 0) {
            return [
              {
                note_id: r.id,
                note_title: r.title,
                folder_name: folderName,
                text: body.slice(0, CONTEXT * 2),
              },
            ];
          }

          const byteToChar = buildByteToCharMap(body);
          const snippets: {
            note_id: string;
            note_title: string;
            folder_name: string;
            text: string;
            charStart: number;
            charEnd: number;
          }[] = [];
          const seen = new Set<string>();

          for (const { byteOffset, byteLen } of bodyOffsets) {
            const charStart = byteToChar[byteOffset] ?? 0;
            const charEnd = byteToChar[byteOffset + byteLen] ?? charStart + 1;
            const fragStart = Math.max(0, charStart - CONTEXT);
            const fragEnd = Math.min(body.length, charEnd + CONTEXT);
            const prefix = fragStart > 0 ? '...' : '';
            const suffix = fragEnd < body.length ? '...' : '';
            const text = `${prefix}${body.slice(fragStart, fragEnd)}${suffix}`;
            const key = `${r.id}:${charStart}:${charEnd}`;
            if (!seen.has(key)) {
              seen.add(key);
              snippets.push({
                note_id: r.id,
                note_title: r.title,
                folder_name: folderName,
                text,
                charStart,
                charEnd,
              });
            }
          }

          return snippets;
        });

        const sliced = results.slice(snippetsOffset ?? 0, (snippetsOffset ?? 0) + MAX_SNIPPETS);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                matchMode: usedMode,
                total: results.length,
                snippets: sliced,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Search error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'get_markdown_content',
    {
      description:
        'Get a portion of a note body. charStart MUST be the value returned by search_markdown_notes — never use 0 or a guessed value. ' +
        'Reads ~4000 chars around the match. ' +
        'The response includes readEnd and totalLength. If readEnd < totalLength and you need more content, call again with charStart = readEnd.',
      inputSchema: z.object({
        noteId: z.string().describe('The ID of the note'),
        charStart: z
          .number()
          .describe(
            'charStart from search_markdown_notes results. The tool reads from max(0, charStart-500) for ~4000 chars. For continuation, pass the readEnd value from the previous response.'
          ),
      }),
    },
    async ({ noteId, charStart }) => {
      const notes = Note.markdownByIds([noteId]);
      if (notes.length === 0) {
        return {
          content: [{ type: 'text', text: '' }],
        };
      }
      const body = notes[0].body ?? '';
      const start = Math.max(0, charStart - 500);
      const len = 4000;
      const text = body.slice(start, start + len);
      const readEnd = Math.min(start + len, body.length);
      const totalLength = body.length;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ content: text, readStart: start, readEnd, totalLength }),
          },
        ],
      };
    }
  );

  server.registerTool(
    'search_note_titles',
    {
      description:
        'Lightweight search over note titles only. Returns note_id, title, folder_name, updated_time. Use this first to quickly find relevant notes by topic before doing full-text search.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Search keyword to match against note titles (partial match, case-insensitive)'
          ),
        maxResults: z.number().describe('Maximum results (default: 10)').optional(),
      }),
    },
    async ({ query, maxResults }) => {
      const MAX = maxResults ?? 10;
      const folderMap = buildFolderNameMap();
      const results = Note.searchByTitle(query, MAX);
      const items = results.map((n) => ({
        note_id: n.id,
        title: n.title,
        folder_name: n.parent_id ? (folderMap[n.parent_id] ?? '') : '',
        updated_time: n.updated_time,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
      };
    }
  );

  return server;
}
