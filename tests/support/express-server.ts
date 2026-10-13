import type { Express } from 'express';
import type { Server } from 'node:http';

export interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function listen(app: Express): Promise<RunningServer> {
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the Express server to bind to a TCP port.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    },
  };
}
