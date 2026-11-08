import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type { Role } from '@prisma/client';
import { createApp } from '../app.js';
import { prisma } from '../config/db.js';
import { hashToken,opaqueToken } from '../middleware/auth.js';

const app=createApp();const origin=process.env.APP_ORIGIN||'http://localhost:5173';
const prefix=`mgmt-${randomUUID()}`;const users:string[]=[];const books:string[]=[];
async function principal(role:Role){
 const user=await prisma.user.create({data:{name:`Gestion fictive ${role}`,email:`${randomUUID()}@usmba.ac.ma`,googleSub:`${prefix}:${randomUUID()}`,role,...(role==='STUDENT'?{student:{create:{studentNumber:`T${randomUUID().replaceAll('-','').slice(0,12)}`,verified:true}}}:{})},include:{student:true}});users.push(user.id);
 const raw=opaqueToken(),csrf=opaqueToken();await prisma.session.create({data:{userId:user.id,tokenHash:hashToken(raw),csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
 return {user,cookie:`library_session=${raw}`,csrf};
}
type Principal=Awaited<ReturnType<typeof principal>>;let staff:Principal,student:Principal,other:Principal,admin:Principal;
function mutation(method:'post'|'patch',path:string,p:Principal,body:unknown){return request(app)[method](path).set('Cookie',p.cookie).set('Origin',origin).set('X-CSRF-Token',p.csrf).send(body);}
async function createBook(){const result=await mutation('post','/api/staff/books',staff,{title:`${prefix} livre`,authors:[`${prefix} auteur`],categories:[`${prefix} catégorie`],priceDh:120}).expect(201);books.push(result.body.id);return result.body;}
beforeAll(async()=>{staff=await principal('LIBRARIAN');student=await principal('STUDENT');other=await principal('STUDENT');admin=await principal('ADMIN');});
afterAll(async()=>{
 const profiles=await prisma.student.findMany({where:{userId:{in:users}},select:{id:true}});const studentIds=profiles.map(s=>s.id);
 await prisma.$transaction([
  prisma.auditLog.deleteMany({where:{userId:{in:users}}}),prisma.statusHistory.deleteMany({where:{actorId:{in:users}}}),prisma.notification.deleteMany({where:{userId:{in:users}}}),prisma.session.deleteMany({where:{userId:{in:users}}}),
  prisma.sanction.deleteMany({where:{studentId:{in:studentIds}}}),prisma.acquisition.deleteMany({where:{studentId:{in:studentIds}}}),
  prisma.copy.deleteMany({where:{bookId:{in:books}}}),prisma.book.deleteMany({where:{id:{in:books}}}),
  prisma.student.deleteMany({where:{userId:{in:users}}}),prisma.user.deleteMany({where:{id:{in:users}}}),
  prisma.author.deleteMany({where:{name:{startsWith:prefix}}}),prisma.category.deleteMany({where:{name:{startsWith:prefix}}}),
 ]);
 await prisma.$disconnect();
});
describe('Catalogue, inventaire et propositions persistantes',()=>{
 it('crée une fiche et des exemplaires, filtre puis archive sans supprimer l’historique',async()=>{
  const b=await createBook();expect(b.availableCount).toBe(0);
  const copies=await mutation('post',`/api/staff/books/${b.id}/copies`,staff,{count:2}).expect(201);expect(copies.body.items).toHaveLength(2);
  const list=await request(app).get('/api/books').query({q:prefix,available:'true'}).expect(200);expect(list.body.items.find((x:any)=>x.id===b.id)).toMatchObject({availableCount:2,totalCount:2,authors:[{name:`${prefix} auteur`} ]});
  expect(JSON.stringify(list.body)).not.toContain(student.user.email);
  await mutation('patch',`/api/staff/books/${b.id}`,staff,{archived:true}).expect(200);
  await request(app).get(`/api/books/${b.id}`).expect(404);expect(await prisma.copy.count({where:{bookId:b.id}})).toBe(2);
  const inventory=await request(app).get('/api/staff/books').set('Cookie',staff.cookie).expect(200);expect(inventory.body.items.find((x:any)=>x.id===b.id).archived).toBe(true);
 });
 it('refuse les opérations de stock à un étudiant et le retour en circulation d’un exemplaire endommagé',async()=>{
  await mutation('post','/api/staff/books',student,{title:'Interdit'}).expect(403);
  const b=await createBook();const copies=await mutation('post',`/api/staff/books/${b.id}/copies`,staff,{count:1}).expect(201);const copyId=copies.body.items[0].id;
  await mutation('patch',`/api/staff/copies/${copyId}`,staff,{condition:'DAMAGED',status:'AVAILABLE',reason:'Contrôle physique'}).expect(400);
  await mutation('patch',`/api/staff/copies/${copyId}`,staff,{condition:'DAMAGED',status:'WITHDRAWN',reason:'Contrôle physique'}).expect(200);
  const detail=await request(app).get(`/api/books/${b.id}`).expect(200);expect(detail.body.availableCount).toBe(0);
 });
 it('isole les notifications et les propositions et exige une acquisition physique',async()=>{
  const note=await prisma.notification.create({data:{userId:student.user.id,type:'TEST',content:'Privé'}});
  await mutation('post',`/api/notifications/${note.id}/read`,other,{}).expect(404);
  const proposal=await mutation('post','/api/acquisitions',student,{title:`${prefix} proposition`,author:'Auteur fictif',category:'Sciences'}).expect(201);const id=proposal.body.id;
  await mutation('post','/api/acquisitions',student,{title:`${prefix} proposition`,author:'Auteur fictif',category:'Sciences'}).expect(409);
  const otherList=await request(app).get('/api/acquisitions').set('Cookie',other.cookie).expect(200);expect(otherList.body.items.some((x:any)=>x.id===id)).toBe(false);
  await mutation('patch',`/api/staff/acquisitions/${id}`,staff,{status:'ACQUIRED'}).expect(409);
  await mutation('patch',`/api/staff/acquisitions/${id}`,staff,{status:'ACCEPTED',comment:'Retenue, achat à effectuer.'}).expect(200);
  const b=await createBook();await mutation('patch',`/api/staff/acquisitions/${id}`,staff,{status:'ACQUIRED',bookId:b.id}).expect(400);
  await mutation('post',`/api/staff/books/${b.id}/copies`,staff,{count:1}).expect(201);
  const acquired=await mutation('patch',`/api/staff/acquisitions/${id}`,staff,{status:'ACQUIRED',bookId:b.id}).expect(200);expect(acquired.body.bookId).toBe(b.id);
 });
});
describe('Administration et corrections traçables',()=>{
 it('enregistre un règlement au guichet une seule fois et réserve les corrections à l’administrateur',async()=>{
  const sanction=await prisma.sanction.create({data:{studentId:student.user.student!.id,type:'FINE',amountDh:90,reason:'Perte fictive'}});
  await mutation('post',`/api/staff/sanctions/${sanction.id}/settle`,staff,{reason:'Règlement reçu au guichet'}).expect(200);
  await mutation('post',`/api/staff/sanctions/${sanction.id}/settle`,staff,{reason:'Deuxième enregistrement'}).expect(409);
  const suspension=await prisma.sanction.create({data:{studentId:student.user.student!.id,type:'SUSPENSION',reason:'À réexaminer',endsAt:new Date(Date.now()+86400000)}});
  await mutation('post',`/api/admin/sanctions/${suspension.id}/revoke`,staff,{reason:'Contestation validée'}).expect(403);
  await mutation('post',`/api/admin/sanctions/${suspension.id}/revoke`,admin,{reason:'Contestation validée après contrôle'}).expect(200);
  expect(await prisma.auditLog.count({where:{entityId:suspension.id,action:'SANCTION_REVOKED'}})).toBe(1);
 });
 it('valide les paramètres, révoque les sessions après changement de rôle et protège le dernier administrateur',async()=>{
  const settings=await request(app).get('/api/admin/settings').set('Cookie',admin.cookie).expect(200);
  await mutation('patch','/api/admin/settings',admin,{maxLoans:0,loanDays:14,pickupHours:48,lateSuspensionDays:7,minorDamageDays:15}).expect(400);
  await mutation('patch','/api/admin/settings',staff,{maxLoans:3,loanDays:14,pickupHours:48,lateSuspensionDays:7,minorDamageDays:15}).expect(403);
  await mutation('patch','/api/admin/settings',admin,{maxLoans:settings.body.maxLoans,loanDays:settings.body.loanDays,pickupHours:settings.body.pickupHours,lateSuspensionDays:settings.body.lateSuspensionDays,minorDamageDays:settings.body.minorDamageDays}).expect(200);
  await mutation('patch',`/api/admin/users/${other.user.id}`,admin,{role:'LIBRARIAN'}).expect(200);
  await request(app).get('/api/staff/dashboard').set('Cookie',other.cookie).expect(401);
  await mutation('patch',`/api/admin/users/${admin.user.id}`,admin,{active:false}).expect(409);
 });
});
