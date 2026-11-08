import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { startJobs } from './jobs/scheduler.js';
const server=app.listen(env.PORT,'0.0.0.0',()=>console.info(`Bibliothèque API : http://localhost:${env.PORT} (${env.DEMO_MODE?'démonstration':'production'})`));
const stopJobs=startJobs();
async function shutdown(){stopJobs();server.close(()=>{void prisma.$disconnect().finally(()=>process.exit(0));});}
process.on('SIGTERM',()=>{void shutdown();});
process.on('SIGINT',()=>{void shutdown();});
