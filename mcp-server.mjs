#!/usr/bin/env node
// ============================================================
// tokenmem MCP Server v2.0.0
// Exposes recall_memory / store_memory / memory_stats tools
// On-demand recall for any MCP-compatible AI agent — saves 80-90% memory token costs
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import {
  initMemory,
  recallMemories,
  getMemoriesByIds,
  storeMemory,
  storeMemoryAsync,
  buildMemoryContext,
  getMemoryStats,
  indexSessionTranscripts,
  closeMemory,
} from './index.mjs'

// Initialize memory system
initMemory()

const server = new McpServer({
  name: 'tokenmem',
  version: '2.0.0',
})

// ── Tool: recall_memory ─────────────────────────────────────
server.tool(
  'recall_memory',
  'Retrieve relevant content from the agent\'s long-term memory. Must call when dealing with personal preferences, past work, project status, relationships, or decisions.',
  {
    query: z.string().describe('Query content — describe what you want to find in natural language'),
    limit: z.number().optional().default(8).describe('Number of results to return, default 8'),
    category: z.enum(['general', 'people', 'project', 'decision', 'feedback', 'bug', 'relationship', 'skill', 'preference']).optional().describe('Filter by category (optional)'),
  },
  async ({ query, limit = 8, category }) => {
    const ctx = await buildMemoryContext({
      query,
      memoryLimit: limit,
    })

    if (!ctx) {
      return { content: [{ type: 'text', text: '(no relevant memories found)' }] }
    }

    return { content: [{ type: 'text', text: ctx }] }
  }
)

// ── Tool: store_memory ──────────────────────────────────────
server.tool(
  'store_memory',
  'Store important information in the agent\'s long-term memory. New preferences, decisions, key facts, and user feedback should be stored promptly. Prefer meta_knowledge level (distilled patterns over concrete steps — higher cross-context reuse value).',
  {
    content: z.string().describe('Content to remember'),
    summary: z.string().optional().describe('One-line summary (optional)'),
    importance: z.number().min(1).max(10).optional().default(6).describe('Importance 1-10, default 6'),
    memory_type: z.enum(['working', 'short_term', 'long_term', 'permanent']).optional().default('long_term').describe('Retention level, default long_term'),
    memory_level: z.enum(['concrete_trace', 'semi_abstract', 'meta_knowledge']).optional().default('semi_abstract').describe('Abstraction level (Memory Transfer Learning): concrete_trace = specific operation logs (low recall weight, prone to negative transfer) / semi_abstract = semi-abstract description (default) / meta_knowledge = patterns/heuristics (high recall weight, most effective cross-context)'),
    category: z.enum(['general', 'people', 'project', 'decision', 'feedback', 'bug', 'relationship', 'skill', 'preference']).optional().default('general').describe('Category'),
    tags: z.array(z.string()).optional().describe('Tag list'),
    event_time: z.union([z.number(), z.string()]).optional().describe('When the event ACTUALLY happened (ISO 8601 string or ms timestamp). Distinct from created_at (when it was recorded). Lets temporal recall match "what did I do last June?" by event_time, not record time. Optional — defaults to NULL (recall falls back to created_at).'),
  },
  async ({ content, summary, importance = 6, memory_type = 'long_term', memory_level = 'semi_abstract', category = 'general', tags = [], event_time }) => {
    const id = await storeMemoryAsync({
      content,
      summary,
      importance,
      memoryType: memory_type,
      memoryLevel: memory_level,
      category,
      source: 'conversation',
      tags,
      eventTime: event_time,
    })

    if (!id) {
      return { content: [{ type: 'text', text: 'Storage failed' }] }
    }

    return { content: [{ type: 'text', text: `Stored memory (id: ${id}, importance: ${importance}, type: ${memory_type}, level: ${memory_level})` }] }
  }
)

// ── Tool: recall_by_id ──────────────────────────────────────
server.tool(
  'recall_by_id',
  'Retrieve specific memories by their rowid(s). Use when you have an id from a previous recall_memory hit and want the full content (not the truncated preview), when you need to inspect a memory before supersede/merge/audit operations, or when following prior_versions[].source_rowid pointers. Returns raw content + summary + full metadata with no truncation; does NOT increment access_count.',
  {
    ids: z.array(z.union([z.number(), z.string()])).describe('Memory rowid(s) to fetch (numbers or numeric strings)'),
    include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted memories. Default false. Use true for audit / prior_versions chain inspection.'),
  },
  async ({ ids, include_deleted = false }) => {
    const rows = getMemoriesByIds(ids, { includeDeleted: include_deleted })
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: '(no memories found for the given ids)' }] }
    }
    const text = rows.map(r => {
      const tags = r.tags?.length ? ` [${r.tags.join(', ')}]` : ''
      const priors = r.prior_versions?.length ? ` (${r.prior_versions.length} prior versions)` : ''
      return `[id:${r.rowid} ★${r.importance} ${r.memory_type} ${r.memory_level}]${tags}${priors}\n${r.summary ? '📌 ' + r.summary + '\n' : ''}${r.content}`
    }).join('\n\n---\n\n')
    return { content: [{ type: 'text', text }] }
  }
)

// ── Tool: memory_stats ──────────────────────────────────────
server.tool(
  'memory_stats',
  'View agent memory system statistics: total memories, layer distribution, conversations, active goals, health metrics.',
  {},
  async () => {
    const stats = getMemoryStats()
    const text = [
      `Total memories: ${stats.memories.total_active}`,
      `  working: ${stats.memories.working} | short_term: ${stats.memories.short_term} | long_term: ${stats.memories.long_term} | permanent: ${stats.memories.permanent}`,
      `Conversations: ${stats.conversations}`,
      `Active goals: ${stats.activeGoals}`,
      `Compression pressure: ${stats.compressionPressure} ${stats.compressionPressure > 1 ? '(warning: temporary memories piling up)' : '(normal)'}`,
      `Dead knowledge (30d unaccessed): ${stats.deadKnowledge}${stats.deadKnowledge > 10 ? ' (consider cleanup)' : ''}`,
      `Search misses (7d): ${stats.recentSearchMisses}${stats.recentSearchMisses > 5 ? ' (knowledge blind spots detected)' : ''}`,
      `Vector search: ${stats.embeddingConfigured ? 'configured' : 'not configured (FTS5 only)'}`,
    ].join('\n')
    return { content: [{ type: 'text', text }] }
  }
)

// Start server
const transport = new StdioServerTransport()
await server.connect(transport)

process.on('SIGINT', () => { closeMemory(); process.exit(0) })
process.on('SIGTERM', () => { closeMemory(); process.exit(0) })
