import { randomUUID } from 'node:crypto';
import { Prisma, AcquisitionStatus, Role, CopyStatus, PhysicalCondition } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { publicBookInclude, serializeBook } from '../repositories/catalogue.js';

type BookInput={title:string;authors:string[];categories:string[];isbn?:string|null;publisher?:string|null;year?:number|null;description?:string;priceDh:number;coverColor?:string;archived?:boolean};
const audit=(tx:Prisma.TransactionClient,userId:string,action:string,entity:string,entityId:string,details?:Prisma.InputJsonValue)=>tx.auditLog.create({data:{userId,action,entity,entityId,details}});
export async function saveBook(userId:string,input:Partial<BookInput>,id?:string) {
  return prisma.$transaction(async tx=>{
    if(id && !await tx.book.findUnique({where:{id}})) throw new HttpError(404,'BOOK_NOT_FOUND','Ouvrage introuvable.');
    const {authors,categories,...fields}=input;
    const relations={...(authors?{authors:{...(id?{set:[]}:{}),connectOrCreate:[...new Set(authors)].map(name=>({where:{name},create:{name}}))}}:{}),...(categories?{categories:{...(id?{set:[]}:{}),connectOrCreate:[...new Set(categories)].map(name=>({where:{name},create:{name}}))}}:{})};
    const book=id?await tx.book.update({where:{id},data:{...fields,...relations},include:publicBookInclude}):await tx.book.create({data:{...fields,title:input.title!,...relations},include:publicBookInclude});
    await audit(tx,userId,id?'BOOK_UPDATED':'BOOK_CREATED','Book',book.id,{title:book.title,archived:book.archived});
    return serializeBook(book);
  });
}
export async function addCopies(userId:string,bookId:string,count:number) {
  return prisma.$transaction(async tx=>{
    const book=await tx.book.findUnique({where:{id:bookId}});
    if(!book || book.archived)throw new HttpError(404,'BOOK_NOT_FOUND','Ouvrage actif introuvable.');
    const items=[];
    for(let i=0;i<count;i++) items.push(await tx.copy.create({data:{bookId,barcode:`BU-${randomUUID().replaceAll('-','').slice(0,14).toUpperCase()}`}}));
    await audit(tx,userId,'COPIES_CREATED','Book',bookId,{count,barcodes:items.map(c=>c.barcode)});
    return {items};
  });
}
export async function updateCopy(userId:string,id:string,input:{condition:PhysicalCondition;status:CopyStatus;reason:string}) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Copy" WHERE id=${id}::uuid FOR UPDATE`;
    const copy=await tx.copy.findUnique({where:{id}});
    if(!copy)throw new HttpError(404,'COPY_NOT_FOUND','Exemplaire introuvable.');
    const assignments=await tx.reservation.count({where:{copyId:id,status:'ACTIVE'}})+await tx.loan.count({where:{copyId:id,status:{in:['ACTIVE','OVERDUE']}}});
    if(assignments)throw new HttpError(409,'COPY_IN_CIRCULATION','Utilisez le parcours de remise ou de retour pour cet exemplaire.');
    if(!['AVAILABLE','WITHDRAWN'].includes(input.status))throw new HttpError(400,'INVALID_COPY_TRANSITION','Les réservations et les prêts passent par leurs parcours dédiés.');
    if(input.status==='AVAILABLE' && input.condition!=='GOOD')throw new HttpError(400,'COPY_UNFIT','Seul un exemplaire en bon état peut être remis en circulation.');
    const result=await tx.copy.update({where:{id},data:{condition:input.condition,status:input.status}});
    await tx.statusHistory.create({data:{entity:'Copy',entityId:id,fromStatus:copy.status,toStatus:result.status,actorId:userId,reason:input.reason}});
    await audit(tx,userId,'COPY_UPDATED','Copy',id,{from:{status:copy.status,condition:copy.condition},to:input,reason:input.reason});
    return result;
  });
}
const acquisitionTransitions:Record<AcquisitionStatus,AcquisitionStatus[]>={SUBMITTED:['REVIEW','ACCEPTED','REFUSED'],REVIEW:['ACCEPTED','REFUSED'],ACCEPTED:['ACQUIRED','REFUSED'],REFUSED:['REVIEW'],ACQUIRED:[]};
export async function reviewAcquisition(userId:string,id:string,input:{status:AcquisitionStatus;comment?:string;bookId?:string}) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Acquisition" WHERE id=${id}::uuid FOR UPDATE`;
    const item=await tx.acquisition.findUnique({where:{id},include:{student:true}});
    if(!item)throw new HttpError(404,'ACQUISITION_NOT_FOUND','Proposition introuvable.');
    if(!acquisitionTransitions[item.status].includes(input.status))throw new HttpError(409,'INVALID_TRANSITION','Cette transition de proposition est interdite.');
    if(input.status==='ACQUIRED'){
      if(!input.bookId)throw new HttpError(400,'BOOK_REQUIRED','Reliez la fiche du livre physiquement acquis.');
      const book=await tx.book.findFirst({where:{id:input.bookId,archived:false,copies:{some:{condition:'GOOD',status:'AVAILABLE'}}}});
      if(!book)throw new HttpError(400,'PHYSICAL_COPY_REQUIRED','Le livre doit posséder au moins un exemplaire disponible en bon état.');
    }
    const result=await tx.acquisition.update({where:{id},data:{status:input.status,comment:input.comment,...(input.status==='ACQUIRED'?{bookId:input.bookId}:{})}});
    await tx.notification.create({data:{userId:item.student.userId,type:'ACQUISITION_REVIEWED',content:`Votre proposition « ${item.title} » : ${{SUBMITTED:'soumise',REVIEW:'en étude',ACCEPTED:'acceptée, en attente d’achat',REFUSED:'refusée',ACQUIRED:'acquise'}[input.status]}.${input.comment?' '+input.comment:''}`}});
    await tx.statusHistory.create({data:{entity:'Acquisition',entityId:id,fromStatus:item.status,toStatus:input.status,actorId:userId,reason:input.comment}});
    await audit(tx,userId,'ACQUISITION_REVIEWED','Acquisition',id,{from:item.status,...input});
    return result;
  });
}
export async function settleSanction(userId:string,id:string,reason:string,revoke=false) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Sanction" WHERE id=${id}::uuid FOR UPDATE`;
    const item=await tx.sanction.findUnique({where:{id},include:{student:true}});
    if(!item)throw new HttpError(404,'SANCTION_NOT_FOUND','Sanction introuvable.');
    if(item.status!=='ACTIVE')throw new HttpError(409,'SANCTION_ALREADY_PROCESSED','Cette sanction a déjà été traitée.');
    if(!revoke && item.type!=='FINE')throw new HttpError(400,'FINE_REQUIRED','Seule une pénalité financière peut être réglée.');
    const status=revoke?'REVOKED':'PAID';
    const result=await tx.sanction.update({where:{id},data:{status}});
    await tx.notification.create({data:{userId:item.student.userId,type:'SANCTION_UPDATED',content:`Sanction ${revoke?'corrigée administrativement':'réglée au guichet'} : ${reason}`}});
    await audit(tx,userId,revoke?'SANCTION_REVOKED':'SANCTION_SETTLED','Sanction',id,{reason,from:item.status,to:status,amountDh:item.amountDh?.toString()??null});
    return result;
  });
}
export async function updateUser(actorId:string,id:string,input:{role?:Role;active?:boolean}) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE role='ADMIN' ORDER BY id FOR UPDATE`;
    const user=await tx.user.findUnique({where:{id}});
    if(!user)throw new HttpError(404,'USER_NOT_FOUND','Utilisateur introuvable.');
    if(user.role==='ADMIN' && (input.role && input.role!=='ADMIN' || input.active===false)) {
      const others=await tx.user.count({where:{role:'ADMIN',active:true,id:{not:id}}});
      if(!others)throw new HttpError(409,'LAST_ADMIN','Le dernier administrateur actif doit être conservé.');
    }
    if(id===actorId && input.active===false)throw new HttpError(409,'SELF_DEACTIVATION','Un autre administrateur doit désactiver votre compte.');
    const result=await tx.user.update({where:{id},data:input,select:{id:true,name:true,email:true,role:true,active:true,student:true}});
    if(result.role==='STUDENT')await tx.student.upsert({where:{userId:id},create:{userId:id},update:{}});
    if(input.active===false || input.role!==undefined)await tx.session.deleteMany({where:{userId:id}});
    await audit(tx,actorId,'USER_UPDATED','User',id,{before:{role:user.role,active:user.active},after:input});
    return result;
  });
}
export async function staffDashboard() {
  const now=new Date();
  const [books,copies,available,reserved,loaned,overdue,damaged,lost,recentRequests,acquisitions]=await prisma.$transaction([
    prisma.book.count({where:{archived:false}}),prisma.copy.count(),prisma.copy.count({where:{status:'AVAILABLE',condition:'GOOD'}}),prisma.copy.count({where:{status:'RESERVED'}}),prisma.copy.count({where:{status:'LOANED'}}),prisma.loan.count({where:{status:{in:['ACTIVE','OVERDUE']},dueAt:{lt:now}}}),prisma.copy.count({where:{condition:'DAMAGED'}}),prisma.copy.count({where:{condition:'LOST'}}),prisma.borrowRequest.findMany({take:8,orderBy:{createdAt:'desc'},include:{book:{select:{id:true,title:true}},student:{include:{user:{select:{id:true,name:true,email:true}}}},reservation:{include:{copy:true}}}}),prisma.acquisition.count({where:{status:{in:['SUBMITTED','REVIEW']}}})
  ]);
  return {books,copies,available,reserved,loaned,overdue,damaged,lost,recentRequests,acquisitions};
}
