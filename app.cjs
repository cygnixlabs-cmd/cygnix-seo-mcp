// Application startup file for cPanel "Setup Node.js App" (Passenger or LiteSpeed lsnode).
// CommonJS on purpose: some runners require() the startup file, and the server itself is ESM.
import("./dist/hosted/cpanel.js").then(m => m.start()).catch(err => { console.error("[cygnix-seo-mcp] failed to start:", err); process.exit(1); });
