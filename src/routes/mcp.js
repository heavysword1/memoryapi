const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateEmbedding } = require('../lib/openai');
const bcrypt = require('bcrypt');

// MCP Tool definitions
const TOOLS = [
  {
    name: 'store_memory',
    description: 'Store a memory or piece of information for later retrieval. Use this to remember facts, decisions, context, or anything important.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store'
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata tags (e.g. {"type": "preference", "topic": "coding"})',
          default: {}
        }
      },
      required: ['content']
    }
  },
  {
    name: 'search_memory',
    description: 'Semantically search stored memories using natural language. Returns the most relevant memories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
          default: 5
        }
      },
      required: ['query']
    }
  },
  {
    name: 'list_memories',
    description: 'List all stored memories in chronological order.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 20)',
          default: 20
        }
      }
    }
  },
  {
    name: 'delete_memory',
    description: 'Delete a specific memory by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The memory ID to delete'
        }
      },
      required: ['id']
    }
  }
];

// Authenticate API key helper
async function authenticateKey(apiKey) {
  if (!apiKey) return null;

  const parts = apiKey.split('.');
  if (parts.length !== 2) return null;

  const prefix = parts[0];

  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_prefix', prefix)
    .single();

  if (error || !keyRecord) return null;

  const valid = await bcrypt.compare(apiKey, keyRecord.key_hash);
  if (!valid) return null;

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRecord.id);

  return keyRecord;
}

// Execute tool
async function executeTool(name, args, agentId, keyRecord) {
  switch (name) {
    case 'store_memory': {
      const { content, metadata = {} } = args;

      if (keyRecord.memory_count >= keyRecord.max_memories) {
        return { 
          error: `Memory limit reached (${keyRecord.max_memories}). Upgrade your plan at memoryapi.org.` 
        };
      }

      const embedding = await generateEmbedding(content);

      const { data, error } = await supabase
        .from('memories')
        .insert({ agent_id: agentId, content, embedding, metadata })
        .select('id, content, metadata, created_at')
        .single();

      if (error) throw error;

      await supabase
        .from('api_keys')
        .update({ memory_count: keyRecord.memory_count + 1 })
        .eq('id', keyRecord.id);

      return { 
        success: true, 
        message: `Memory stored successfully.`,
        id: data.id,
        content: data.content
      };
    }

    case 'search_memory': {
      const { query, limit = 5 } = args;
      const embedding = await generateEmbedding(query);

      const { data, error } = await supabase.rpc('search_memories', {
        query_embedding: embedding,
        match_agent_id: agentId,
        match_threshold: 0.4,
        match_count: limit
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return { success: true, message: 'No relevant memories found.', results: [] };
      }

      return {
        success: true,
        count: data.length,
        results: data.map(m => ({
          id: m.id,
          content: m.content,
          similarity: Math.round(m.similarity * 100) + '%',
          metadata: m.metadata,
          created_at: m.created_at
        }))
      };
    }

    case 'list_memories': {
      const { limit = 20 } = args;

      const { data, error } = await supabase
        .from('memories')
        .select('id, content, metadata, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return {
        success: true,
        count: data.length,
        memories: data
      };
    }

    case 'delete_memory': {
      const { id } = args;

      const { error } = await supabase
        .from('memories')
        .delete()
        .eq('id', id)
        .eq('agent_id', agentId);

      if (error) throw error;

      const newCount = Math.max(0, keyRecord.memory_count - 1);
      await supabase
        .from('api_keys')
        .update({ memory_count: newCount })
        .eq('id', keyRecord.id);

      return { success: true, message: `Memory ${id} deleted.` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP JSON-RPC handler
router.post('/', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const keyRecord = await authenticateKey(apiKey);

  if (!keyRecord) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized. Include x-api-key header.' },
      id: req.body?.id || null
    });
  }

  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid JSON-RPC version.' },
      id: id || null
    });
  }

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'MemoryAPI', version: '1.0.0' }
        };
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args, keyRecord.agent_id, keyRecord);
        result = {
          content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
        };
        break;
      }

      case 'ping':
        result = {};
        break;

      default:
        return res.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id
        });
    }

    res.json({ jsonrpc: '2.0', result, id });

  } catch (err) {
    console.error('MCP error:', err);
    res.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err.message || 'Internal error' },
      id
    });
  }
});

module.exports = router;
