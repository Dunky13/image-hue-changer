import { serve, type ServerWebSocket } from "bun";
import fs from "fs";
import path from "path";
import os from "os";

function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip over internal (i.e. 127.0.0.1) and non-IPv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
}
// Keep track of connected WebSocket clients
const clients = new Set<ServerWebSocket<unknown>>();

// The port on which the server will run
const PORT = 3001;

const hmr = (ip: string) => `
<script>
  const ws = new WebSocket("ws://${ip}:${PORT}/ws");

  ws.onopen = () => {
    console.log("Connected to hot reload WebSocket");
  };

  // When a "reload" message is received, reload the page.
  ws.onmessage = (event) => {
    if (event.data === "reload") {
      console.log("File changed. Reloading...");
      window.location.reload();
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error observed:", err);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };
</script>
`



// Create the HTTP/WebSocket server
const server = serve({
  port: PORT,
  // The `fetch` handler processes both HTTP requests and WebSocket upgrades.
  // Requests to `/ws` will be upgraded to WebSocket connections.
  async fetch(request) {
    const url = new URL(request.url);
    if (server.upgrade(request)) {
      return; // do not return a Response
    }
    if (url.pathname === "/ws") {
      // Bun automatically upgrades if the client requests a WebSocket
      return new Response(null, { status: 101 });
    }
    const localIp = getLocalIPAddresses()[0] || 'localhost'
    const transformIndex = new HTMLRewriter().on('head', {
      element(head) {
        head.append(hmr(localIp), {html: true});
      }
    });
    // For any other route, serve the index.html file.
    const filePath = path.join(process.cwd(), "index.html");
    const file = Bun.file(filePath);
    const transformed = transformIndex.transform(await file.text());
    return new Response(transformed, {
      headers: { "content-type": "text/html" },
    });
  },
  // Configure the WebSocket behavior on `/ws`
  websocket: {
    // Called for every new WebSocket connection.
    open(ws) {
      console.log("WebSocket connected");
      clients.add(ws);
    },
    // Called when a WebSocket connection is closed.
    close(ws) {
      console.log("WebSocket disconnected");
      clients.delete(ws);
    },
    // Optional: Handle incoming messages if needed.
    message(ws, message) {
      // For now we don't expect messages from the client.
      console.log("Received message:", message);
    },
  },
});
const localIp = getLocalIPAddresses()[0] || 'localhost';
console.log(`Server is running at http://${localIp}:${PORT}`);

// Watch the index.html file for changes (hot reloading)
const fileToWatch = path.join(process.cwd(), "index.html");

// Using fs.watch to monitor changes in index.html file.
fs.watch(fileToWatch, (eventType, filename) => {
  if (filename) {
    console.log(`File Changed: ${filename} (Event: ${eventType})`);
    // Broadcast a "reload" message to all connected WebSocket clients.
    for (const ws of clients) {
      try {
        ws.send("reload");
      } catch (err) {
        console.warn("Error sending message: ", err);
      }
    }
  }
});
