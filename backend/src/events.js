// Server-sent events hub: the tablet keeps one GET /api/events connection open and
// the backend pushes proactive calls, family messages and reminder triggers here.

const clients = new Set();

export function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  clients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

export function publish(type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

export function clientCount() {
  return clients.size;
}
