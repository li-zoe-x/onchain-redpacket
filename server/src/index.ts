import 'dotenv/config';
import { createApp } from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = createApp();
app.listen(PORT, () => {
  console.log(`\n🧧 Onchain Red Packet Agent`);
  console.log(`   Server:    http://localhost:${PORT}`);
  console.log(`   Claim URL: http://localhost:${PORT}/claim/<packet-id>`);
  console.log(`   API:       http://localhost:${PORT}/api/packets\n`);
});
