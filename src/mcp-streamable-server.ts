import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express, { Request, Response } from "express";
import cors from "cors";
import * as tools from "./tools/index.js";
import { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_SA_ID, APS_SA_EMAIL, APS_SA_KEY_ID, APS_SA_PRIVATE_KEY } from "./config.js";

// Validate environment variables
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_SA_ID || !APS_SA_EMAIL || !APS_SA_KEY_ID || !APS_SA_PRIVATE_KEY) {
    console.error("Missing one or more required environment variables: APS_CLIENT_ID, APS_CLIENT_SECRET, APS_SA_ID, APS_SA_EMAIL, APS_SA_KEY_ID, APS_SA_PRIVATE_KEY");
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || process.env.HTTP_PORT || 3000;

// CORS middleware - Allow Microsoft Copilot Studio and other clients
app.use(cors({
    origin: true, // Allow all origins for now, restrict in production
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-ms-agentic-protocol']
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        server: 'APS MCP Streamable Server',
        version: '1.0.0'
    });
});

// Create MCP server instance
const mcpServer = new McpServer({ 
    name: "autodesk-platform-services", 
    version: "1.0.0" 
});

// Register all tools
for (const tool of Object.values(tools)) {
    mcpServer.tool(tool.title, tool.description, tool.schema, tool.callback);
}

// MCP GET endpoint for initial handshake/session establishment
app.get('/mcp', (req: Request, res: Response) => {
    try {
        console.log('MCP GET request received for handshake');
        
        // Return server capabilities and info
        res.json({
            jsonrpc: "2.0",
            result: {
                protocolVersion: "2024-11-05",
                capabilities: {
                    tools: {}
                },
                serverInfo: {
                    name: "autodesk-platform-services",
                    version: "1.0.0"
                },
                instructions: "Use POST /mcp for JSON-RPC 2.0 requests"
            }
        });
    } catch (error) {
        console.error('MCP GET endpoint error:', error);
        res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

// MCP Streamable endpoint - This is what Microsoft Copilot Studio will call
app.post('/mcp', async (req: Request, res: Response) => {
    try {
        console.log('MCP Request received:', JSON.stringify(req.body, null, 2));
        
        const mcpRequest = req.body;
        
        // Validate JSON-RPC format
        if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== "2.0") {
            return res.status(400).json({
                jsonrpc: "2.0",
                id: mcpRequest.id || null,
                error: {
                    code: -32600,
                    message: "Invalid Request - missing or invalid jsonrpc field"
                }
            });
        }

        // Handle MCP protocol messages
        const response = await handleMcpRequest(mcpRequest);
        
        console.log('MCP Response:', JSON.stringify(response, null, 2));
        res.json(response);
        
    } catch (error) {
        console.error('MCP endpoint error:', error);
        res.status(500).json({
            jsonrpc: "2.0",
            id: req.body?.id || null,
            error: {
                code: -32603,
                message: "Internal error",
                data: error instanceof Error ? error.message : String(error)
            }
        });
    }
});

// Handle MCP protocol requests
async function handleMcpRequest(request: any) {
    const { jsonrpc, id, method, params } = request;

    try {
        switch (method) {
            case 'initialize':
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: "autodesk-platform-services",
                            version: "1.0.0"
                        }
                    }
                };

            case 'tools/list':
                const toolsList = Object.values(tools).map(tool => ({
                    name: tool.title,
                    description: tool.description,
                    inputSchema: tool.schema
                }));
                
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        tools: toolsList
                    }
                };

            case 'tools/call':
                const { name, arguments: args } = params;
                const tool = Object.values(tools).find(t => t.title === name);
                
                if (!tool) {
                    return {
                        jsonrpc: "2.0",
                        id,
                        error: {
                            code: -32602,
                            message: `Tool "${name}" not found`
                        }
                    };
                }

                try {
                    // Create proper request handler extra
                    const requestExtra = {
                        requestId: id?.toString() || Math.random().toString(36),
                        signal: new AbortController().signal,
                        sendNotification: async () => {},
                        sendRequest: async () => ({ result: {} })
                    };
                    
                    const result = await tool.callback(args || {}, requestExtra);
                    
                    return {
                        jsonrpc: "2.0",
                        id,
                        result: result
                    };
                } catch (toolError) {
                    return {
                        jsonrpc: "2.0",
                        id,
                        error: {
                            code: -32603,
                            message: "Tool execution failed",
                            data: toolError instanceof Error ? toolError.message : String(toolError)
                        }
                    };
                }

            default:
                return {
                    jsonrpc: "2.0",
                    id,
                    error: {
                        code: -32601,
                        message: `Method "${method}" not found`
                    }
                };
        }
    } catch (error) {
        return {
            jsonrpc: "2.0",
            id,
            error: {
                code: -32603,
                message: "Internal error",
                data: error instanceof Error ? error.message : String(error)
            }
        };
    }
}

// API information endpoint for debugging
app.get('/mcp/info', (req: Request, res: Response) => {
    res.json({
        server: "APS MCP Streamable Server",
        version: "1.0.0",
        protocol: "MCP over HTTP (Streamable)",
        supportedMethods: [
            "initialize",
            "tools/list", 
            "tools/call"
        ],
        availableTools: Object.values(tools).map(tool => ({
            name: tool.title,
            description: tool.description
        })),
        endpoints: {
            mcp: "/mcp (POST) - MCP protocol endpoint",
            health: "/health (GET) - Health check",
            info: "/mcp/info (GET) - This endpoint"
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 APS MCP Streamable Server running on port ${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(`🔧 MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`ℹ️  API info: http://localhost:${PORT}/mcp/info`);
    console.log(`🛠️  Available tools: ${Object.values(tools).map(t => t.title).join(', ')}`);
    console.log(`📘 Ready for Microsoft Copilot Studio integration!`);
});
