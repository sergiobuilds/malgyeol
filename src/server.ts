import { createCareApp } from './careApp.ts';

const port = Number(process.env.PORT ?? 8080);
const server = createCareApp();
server.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  process.stdout.write(`malgyeol listening on ${port}\n`);
});
