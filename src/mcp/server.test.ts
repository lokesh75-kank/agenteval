// Tests for the MCP server's lazy loading of the optional @modelcontextprotocol/sdk.
//
// Regression guard for issue #3: importing this module must NOT statically pull
// in the optional SDK peer dep, so `import 'agenteval-core/mcp'` loads cleanly
// even when the SDK is absent, and only errors when the server is actually built.

import { describe, expect, it, vi } from 'vitest';

describe('mcp/server lazy SDK loading', () => {
  it('imports the module without requiring the SDK at load time', async () => {
    // If the SDK were imported statically this would throw when it is absent.
    // Here it simply must resolve and expose the public entry points.
    const mod = await import('./server.js');
    expect(typeof mod.createServer).toBe('function');
    expect(typeof mod.main).toBe('function');
  });

  it('createServer is async and only touches the SDK when called', async () => {
    const { createServer } = await import('./server.js');
    const server = await createServer();
    // Low-level MCP Server exposes request-handler registration + connect.
    expect(typeof server.setRequestHandler).toBe('function');
    expect(typeof server.connect).toBe('function');
  });

  it('surfaces a clear, actionable error when the SDK cannot be loaded', async () => {
    vi.resetModules();
    // Simulate the optional peer dep being absent.
    vi.doMock('@modelcontextprotocol/sdk/server/index.js', () => {
      throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
    });

    const { createServer } = await import('./server.js');
    await expect(createServer()).rejects.toThrow(/@modelcontextprotocol\/sdk/);
    await expect(createServer()).rejects.toThrow(/install/i);

    vi.doUnmock('@modelcontextprotocol/sdk/server/index.js');
    vi.resetModules();
  });
});
