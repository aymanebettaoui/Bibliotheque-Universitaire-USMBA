import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { loadSession,csrfProtection,assertAuthConfiguration } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { catalogueRouter } from './routes/catalogue.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { managementRouter } from './routes/management.js';
import { circulationRouter } from './routes/circulation.js';
import { coversRouter } from './routes/covers.js';
import { asyncRoute } from './utils/http.js';

export function createApp() {
  assertAuthConfiguration();
  const app=express();
  app.disable('x-powered-by');
  app.use(helmet({crossOriginOpenerPolicy:{policy:'same-origin-allow-popups'},contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],scriptSrc:["'self'","'wasm-unsafe-eval'",'https://accounts.google.com','https://cdn.jsdelivr.net'],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com','https://accounts.google.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:','blob:','https:'],connectSrc:["'self'",'https://accounts.google.com','https://cdn.jsdelivr.net','https://tessdata.projectnaptha.com'],workerSrc:["'self'",'blob:'],frameSrc:['https://accounts.google.com'],upgradeInsecureRequests:env.NODE_ENV==='production'?[]:null
  }}}));
  app.use(cors({origin:env.APP_ORIGIN,credentials:true,methods:['GET','POST','PATCH','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token']}));
  app.use('/api',rateLimit({windowMs:15*60*1000,limit:1000,standardHeaders:'draft-7',legacyHeaders:false,skip:()=>env.NODE_ENV==='test',message:{error:{code:'RATE_LIMIT',message:'Trop de requêtes. Réessayez dans quelques minutes.'}}}));
  app.use(express.json({limit:'256kb'}));
  app.get('/api/health',asyncRoute(async(_req,res)=>{await prisma.$queryRaw`SELECT 1`;res.json({status:'ok',database:'connected',demo:env.DEMO_MODE});}));
  app.use('/api',loadSession,csrfProtection);
  app.use('/api',authRouter,catalogueRouter,studentRouter,managementRouter,circulationRouter,coversRouter);
  app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Cette route API est introuvable.'}}));
  const frontendDist=fileURLToPath(new URL('../../frontend/dist',import.meta.url));
  if(existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*',(_req,res)=>res.sendFile(`${frontendDist}/index.html`));
  }
  app.use(errorHandler);
  return app;
}
export const app=createApp();
