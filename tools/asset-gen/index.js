#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const server = new Server({ name: "asset-gen", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "generate_asset",
    description: "Generate a 3D model (GLB) or Image using AI. Returns a URL.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Description of the asset (e.g. 'Dutch canal house')" },
        type: { type: "string", enum: ["3d", "image"], description: "Type of asset to generate" }
      },
      required: ["prompt", "type"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "generate_asset") throw new Error("Unknown tool");
  
  const { prompt, type } = request.params.arguments;
  let output;

  try {
    if (type === "3d") {
      output = await replicate.run("camenduru/meshy-4", { input: { prompt, save_format: "glb" } });
    } else {
      const res = await replicate.run("black-forest-labs/flux-schnell", { input: { prompt } });
      output = res[0]; // Flux returns an array
    }
    return { content: [{ type: "text", text: `Asset Generated: ${output}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);