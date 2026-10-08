#!/usr/bin/env node
/**
 * Local SMTP sink — development helper only.
 *
 * Some adverts ask you to email your CV. To exercise that path end-to-end without a
 * real mailbox, this listens for SMTP on a local port and writes each received
 * message to `data/outbox/` as a .eml file, replying "250 OK" exactly like a real
 * server would (so nodemailer sees a genuine accepted message and a messageId).
 *
 * It is NOT part of the product: nothing in the app depends on it, and it must never
 * be used in production. Configure the server with:
 *
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_SECURE=false SMTP_FROM=hunter@localhost
 *
 * Usage: node tools/smtp-sink.js [port]
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || process.env.SMTP_SINK_PORT || 2525);
const outDir = path.resolve(process.env.SMTP_SINK_DIR || 'data/outbox');
fs.mkdirSync(outDir, { recursive: true });

let counter = 0;

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  let inData = false;
  let message = '';
  let from = '';
  const recipients = [];

  const write = (line) => socket.write(`${line}\r\n`);

  write('220 smtp-sink ready');

  socket.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (inData) {
        if (line === '.') {
          inData = false;
          fs.mkdirSync(outDir, { recursive: true }); // the data dir may have been cleared since boot
          const file = path.join(outDir, `${Date.now()}-${++counter}.eml`);
          fs.writeFileSync(file, message);
          console.log(`[smtp-sink] received ${recipients.join(', ')} (${Buffer.byteLength(message)} bytes) -> ${file}`);
          message = '';
          write('250 OK queued');
        } else {
          message += `${line}\n`;
        }
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        write('250-smtp-sink');
        write('250 SIZE 104857600');
      } else if (upper.startsWith('MAIL FROM')) {
        from = line.slice(line.indexOf(':') + 1).trim();
        write('250 OK');
      } else if (upper.startsWith('RCPT TO')) {
        recipients.push(line.slice(line.indexOf(':') + 1).trim());
        write('250 OK');
      } else if (upper === 'DATA') {
        inData = true;
        write('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'RSET') {
        message = '';
        recipients.length = 0;
        write('250 OK');
      } else if (upper === 'QUIT') {
        write('221 Bye');
        socket.end();
      } else if (upper.startsWith('NOOP')) {
        write('250 OK');
      } else if (upper.startsWith('AUTH')) {
        // No authentication: this is a local development sink.
        write('530 Authentication not required on this sink');
      } else {
        write('250 OK');
      }
    }
  });

  socket.on('error', () => {});
  process.on('uncaughtException', (err) => console.error('[smtp-sink] error:', err.message));
});

// Bind to the loopback interface only: the app reaches it on 127.0.0.1, and it is never
// exposed as a public/preview port (an HTTP request to a raw SMTP socket would surface
// as a confusing 502 from whatever is proxying it).
server.listen(port, '127.0.0.1', () => {
  console.log(`[smtp-sink] listening on 127.0.0.1:${port} — writing messages to ${outDir}`);
  console.log('[smtp-sink] development helper only: run the real server with SMTP_HOST/SMTP_PORT pointing at a genuine mail account.');
});
