import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ViewerUtil } from '../../lib/viewerUtil';
import { Note } from '@/lib/note';
import { OpenAIEmbeddings } from '@langchain/openai';
import * as fs from 'fs';

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

const MAX_RESPONSE_CHARS = 8000;

function truncateResponse(text: string): string {
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  return text.slice(0, MAX_RESPONSE_CHARS) + '...(truncated)';
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

  // server.registerTool(
  //   'get_note_content',
  //   {
  //     description: 'Get the content of a specific note',
  //     inputSchema: z.object({
  //       noteId: z.string().describe('The ID of the note'),
  //       offset: z.number().describe('The offset to start reading the note content from').optional(),
  //       length: z.number().describe('The length of the content to read').optional(),
  //     }),
  //   },
  //   async ({ noteId, offset, length }) => {
  //     const content = Note.getNoteById(noteId);
  //     if (!content) {
  //       return {
  //         content: [{ type: 'text', text: '' }],
  //       };
  //     }

  //     let bodyText = content.body ?? '';

  //     if (bodyText) {
  //       const turndownService = new TurndownService({
  //         headingStyle: 'atx',
  //         codeBlockStyle: 'fenced',
  //       });
  //       bodyText = turndownService.turndown(bodyText);
  //     }

  //     if (offset !== undefined && length !== undefined) {
  //       const text = bodyText.slice(offset, offset + length);
  //       return {
  //         content: [{ type: 'text', text }],
  //       };
  //     }
  //     return {
  //       content: [{ type: 'text', text: bodyText }],
  //     };
  //   }
  // );

  server.registerTool(
    'search_markdown_notes',
    {
      description:
        'Full-text search over markdown_notes. Returns snippets around matched keywords instead of full note bodies. Each snippet includes charStart/charEnd indicating the match position in the note body, which can be used as offset/length for get_markdown_content.',
      inputSchema: z.object({
        query: z
          .string()
          .describe('Search keyword(s) for full-text search (SQLite FTS4 MATCH syntax)'),
        maxResults: z.number().describe('Maximum number of results to return').optional(),
        contextChars: z
          .number()
          .describe('Number of characters to include before and after each match (default: 100)')
          .optional(),
        maxSnippets: z
          .number()
          .describe('Maximum number of snippets to return (default: 200)')
          .optional(),
        snippetsOffset: z
          .number()
          .describe('Offset (starting index) of snippets to return (default: 0)')
          .optional(),
      }),
    },
    async ({ query, maxResults, contextChars, maxSnippets, snippetsOffset }) => {
      const CONTEXT = contextChars ?? 100;
      const BODY_COL = 2; // markdown_notes_fts 列順: 0=id(notindexed), 1=title, 2=body
      try {
        const searchResults = Note.selectAllMarkdownFts(query);
        const ranked = [...searchResults].sort((a, b) => {
          const countA = a.offsets ? Math.floor(a.offsets.split(' ').length / 4) : 0;
          const countB = b.offsets ? Math.floor(b.offsets.split(' ').length / 4) : 0;
          return countB - countA;
        });
        const limited = maxResults ? ranked.slice(0, maxResults) : ranked;
        const ids = limited.map((r) => r.id);
        const notes = Note.markdownByIds(ids);
        const noteMap: Record<string, (typeof notes)[0]> = {};
        for (const n of notes) {
          noteMap[n.id] = n;
        }

        const results = limited.flatMap((r) => {
          const note = noteMap[r.id];
          const body = note?.body ?? '';
          if (!body) return [];

          if (!r.offsets) {
            return [{ note_id: r.id, note_title: r.title, text: body.slice(0, CONTEXT * 2) }];
          }

          const nums = r.offsets.split(' ').map(Number);
          const bodyOffsets: { byteOffset: number; byteLen: number }[] = [];
          for (let i = 0; i + 3 < nums.length; i += 4) {
            if (nums[i] === BODY_COL) {
              bodyOffsets.push({ byteOffset: nums[i + 2], byteLen: nums[i + 3] });
            }
          }

          if (bodyOffsets.length === 0) {
            return [{ note_id: r.id, note_title: r.title, text: body.slice(0, CONTEXT * 2) }];
          }

          const byteToChar = buildByteToCharMap(body);
          const snippets: {
            note_id: string;
            note_title: string;
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
              snippets.push({ note_id: r.id, note_title: r.title, text, charStart, charEnd });
            }
          }

          return snippets;
        });

        return {
          content: [
            {
              type: 'text',
              text: truncateResponse(
                JSON.stringify(
                  results.slice(snippetsOffset ?? 0, (snippetsOffset ?? 0) + (maxSnippets ?? 200))
                )
              ),
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
        'Get a substring of a note body from markdown_notes. Use offset and length from search_markdown_notes results to fetch the exact portion you need.',
      inputSchema: z.object({
        noteId: z.string().describe('The ID of the note'),
        offset: z.number().describe('The character offset to start reading from'),
        length: z.number().describe('The number of characters to read'),
      }),
    },
    async ({ noteId, offset, length }) => {
      const notes = Note.markdownByIds([noteId]);
      if (notes.length === 0) {
        return {
          content: [{ type: 'text', text: '' }],
        };
      }
      const body = notes[0].body ?? '';
      const text = truncateResponse(body.slice(offset, offset + length));
      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  return server;
}
