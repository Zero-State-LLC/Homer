/**
 * Scripts run by the proxy image (a pinned Node image). Both are trusted, written by the runner,
 * and mounted read-only. Neither takes input from the agent except proxy requests.
 */

/** The proxy port on the internal network. */
export const PROXY_PORT = 3128;

/**
 * An HTTPS CONNECT proxy that allows only exact host names on port 443. Arguments: listen
 * address, port, then the allowed host names. Plain HTTP requests are refused.
 */
export const PROXY_SCRIPT = `import http from "node:http";
import net from "node:net";

const [listenHost, portText, ...hosts] = process.argv.slice(2);
const allowed = new Set(hosts.map((host) => host.toLowerCase()));
const server = http.createServer((request, response) => {
  response.writeHead(403).end();
});
server.on("connect", (request, socket, head) => {
  const match = /^([A-Za-z0-9.-]+):443$/.exec(request.url ?? "");
  const host = match ? match[1].toLowerCase() : "";
  if (!allowed.has(host)) {
    socket.end("HTTP/1.1 403 Forbidden\\r\\n\\r\\n");
    return;
  }
  const upstream = net.connect(443, host, () => {
    socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
server.on("clientError", (error, socket) => socket.destroy());
server.listen(Number(portText), listenHost);
`;

/**
 * Exit codes of the egress probe, run on the internal network before each session: a direct
 * connection out must fail, and the proxy must answer.
 */
export const PROBE_OK = 0;
export const PROBE_EGRESS_OPEN = 2;
export const PROBE_NO_PROXY = 3;

/** Arguments: proxy address, proxy port, then a public address to try directly. */
export const PROBE_SCRIPT = `import net from "node:net";

const [proxyHost, proxyPort, outside] = process.argv.slice(2);
const attempt = (port, host) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: 3000 });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
if (await attempt(443, outside)) process.exit(${PROBE_EGRESS_OPEN});
for (let tries = 0; tries < 20; tries++) {
  if (await attempt(Number(proxyPort), proxyHost)) process.exit(${PROBE_OK});
  await new Promise((resolve) => setTimeout(resolve, 250));
}
process.exit(${PROBE_NO_PROXY});
`;
