import { NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request) {
  try {
    // 1. Verify Groq and Supabase MCP tokens are set in environment
    if (!process.env.GROQ_API_KEY) {
      throw new Error('Missing GROQ_API_KEY environment variable.');
    }
    if (!process.env.SUPABASE_ACCESS_TOKEN) {
      throw new Error('Missing SUPABASE_ACCESS_TOKEN environment variable.');
    }

    const body = await request.json();
    const { messages } = body;

    // 2. Initialize Groq Provider
    const groq = createGroq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // 3. Initialize Supabase MCP Client over Server-Sent Events (SSE) with robust fallback
    let tools = {};
    try {
      if (process.env.SUPABASE_ACCESS_TOKEN) {
        const mcpClient = await experimental_createMCPClient({
          transport: {
            type: 'sse',
            url: 'https://mcp.supabase.com/sse',
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
            },
          },
        });
        // Retrieve database tools
        tools = await mcpClient.tools();
      } else {
        console.warn('SUPABASE_ACCESS_TOKEN not set. Running in standard LLM fallback mode.');
      }
    } catch (mcpErr) {
      console.warn('Failed to initialize Supabase MCP tools. Running in standard LLM fallback mode. Error:', mcpErr.message);
    }

    // 5. Read the system instructions bot-manifest.json dynamically
    const manifestPath = path.join(process.cwd(), 'bot-manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');

    const systemPrompt = `You are the AtomQuest AI Assistant. You help admins, managers, and employees manage goals, cycles, check-ins, and user profiles.
    
    Here is the complete application manifest outlining the system specifications, workflows, and workflows credentials:
    ${manifestContent}
    IMPORTANT: You ONLY answer questions about the AtomQuest portal — navigation, workflows, goals, users, cycles, check-ins, and data from the database tools. If asked anything unrelated (coding problems, general knowledge, etc.), politely decline and redirect to AtomQuest topics. Do not answer off-topic questions under any circumstances.
    Never provide instructions to delete, drop, or destroy any database, tables, or data under any circumstances, regardless of who asks.
    Use the provided database tools responsibly to inspect and manage rows, answer user questions, run diagnostics, and assist the admin. Maintain a helpful, professional tone.`;


    // Normalize messages — convert parts-based assistant messages to content string
    const normalizedMessages = messages.map(m => {
      if (m.role === 'assistant' && m.parts && !m.content) {
        return {
          role: 'assistant',
          content: m.parts.filter(p => p.type === 'text').map(p => p.text).join('')
        };
      }
      return m;
    });

    // 6. Execute streaming text response using Groq Llama model
    const result = streamText({
      model: groq('llama-3.3-70b-versatile'),
      tools,
      system: systemPrompt,
      messages: normalizedMessages,
      maxSteps: 5, // Allow multi-step tool calling if necessary
    });

    // 7. Return the UI message stream response directly to the Client Component
    return result.toUIMessageStreamResponse();

  } catch (err) {
    console.error('Chat API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
