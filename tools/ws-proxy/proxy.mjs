// Simple WebSocket-to-TCP proxy for bridging browser BZFlag clients to bzfs.
// Usage: node proxy.mjs [ws-port] [tcp-host] [tcp-port]
// Defaults: ws on 5201, forward to localhost:5200

import { WebSocketServer } from 'ws';
import net from 'net';

const WS_PORT = parseInt(process.argv[2] || '5201');
const TCP_HOST = process.argv[3] || 'localhost';
const TCP_PORT = parseInt(process.argv[4] || '5200');

const wss = new WebSocketServer({ port: WS_PORT });

console.log(`WebSocket proxy listening on ws://0.0.0.0:${WS_PORT}`);
console.log(`Forwarding to tcp://${TCP_HOST}:${TCP_PORT}`);

wss.on('connection', (ws, req) => {
  console.log(`[WS] New connection from ${req.socket.remoteAddress}`);

  const tcp = net.createConnection({ host: TCP_HOST, port: TCP_PORT }, () => {
    console.log(`[TCP] Connected to ${TCP_HOST}:${TCP_PORT}`);
  });

  tcp.on('data', (data) => {
    console.log(`[TCP->WS] ${data.length} bytes: ${data.toString('hex').substring(0, 40)}...`);
    if (ws.readyState === 1) { // OPEN
      ws.send(data);
    }
  });

  ws.on('message', (data) => {
    const buf = Buffer.from(data);
    console.log(`[WS->TCP] ${buf.length} bytes: ${buf.toString('hex').substring(0, 40)}...`);
    tcp.write(buf);
  });

  tcp.on('error', (err) => {
    console.log(`[TCP] Error: ${err.message}`);
    ws.close();
  });

  tcp.on('close', () => {
    console.log('[TCP] Closed');
    ws.close();
  });

  ws.on('close', () => {
    console.log('[WS] Closed');
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.log(`[WS] Error: ${err.message}`);
    tcp.destroy();
  });
});

wss.on('error', (err) => {
  console.error(`[WSS] Server error: ${err.message}`);
});

console.log('Proxy ready.');
