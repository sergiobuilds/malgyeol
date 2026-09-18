/** Independent local integration fixture. No telephone SDK or provider client. */
import { createCareApp } from '../src/careApp.ts';
const server = createCareApp();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
  }
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
