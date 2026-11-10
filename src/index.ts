#!/usr/bin/env node
// Local stdio entry point (npm `cygnix-seo-mcp`). Unchanged behaviour: free, no API key, runs on your machine.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSeoServer } from "./server.js";

await createSeoServer().connect(new StdioServerTransport());
