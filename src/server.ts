import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 8080);
const server = createApp();
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`benefit-settlement-rail listening on ${port}\n`);
});
