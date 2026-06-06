// Runnable entry point — starts the 전자서점 storefront.
import { buildPlatform } from './app';

const securityServer = process.env.CRYPTON_SERVER_URL ?? 'http://127.0.0.1:7070';
const port = Number(process.env.PLATFORM_PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildPlatform({ securityServer, logger: true });
await app.listen({ port, host });
app.log.info(`crypton 전자서점 listening at http://${host}:${port} → security server ${securityServer}`);
