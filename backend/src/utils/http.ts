import type { RequestHandler } from 'express';
export const asyncRoute = (handler: (...args: any[]) => Promise<any>): RequestHandler => (req,res,next) => { Promise.resolve(handler(req,res,next)).catch(next); };
