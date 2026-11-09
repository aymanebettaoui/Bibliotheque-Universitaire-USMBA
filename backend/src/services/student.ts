import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { publicBookInclude, serializeBook } from '../repositories/catalogue.js';

export async function studentFor(userId:string) {
  const student=await prisma.student.findUnique({where:{userId}});
  if(!student) throw new HttpError(403,'STUDENT_REQUIRED','Un profil étudiant est nécessaire.');
  return student;
}
export async function studentDashboard(userId:string) {
  const student=await studentFor(userId); const now=new Date();
  const [loans,requests,notifications,sanctions]=await prisma.$transaction([
    prisma.loan.findMany({where:{studentId:student.id,status:{in:['ACTIVE','OVERDUE']}},include:{copy:{include:{book:{include:{authors:true}}}}},orderBy:{dueAt:'asc'}}),
    prisma.borrowRequest.findMany({where:{studentId:student.id},include:{book:{select:{title:true}},reservation:true},orderBy:{createdAt:'desc'},take:20}),
    prisma.notification.findMany({where:{userId},orderBy:{createdAt:'desc'},take:5}),
    prisma.sanction.count({where:{studentId:student.id,status:'ACTIVE',type:{in:['BAN','SUSPENSION']},OR:[{endsAt:null},{endsAt:{gt:now}}]}}),
  ]);
  return {activeLoans:loans.length,pendingRequests:requests.filter(r=>r.status==='PENDING').length,acceptedRequests:requests.filter(r=>r.status==='ACCEPTED' && r.reservation?.status==='ACTIVE').length,overdueLoans:loans.filter(l=>l.dueAt<now).length,activeSanctions:sanctions,nextReturns:loans,loans,requests,notifications};
}
export async function recommendations(userId:string) {
  const student=await studentFor(userId);
  const history=await prisma.loan.findMany({where:{studentId:student.id},include:{copy:{include:{book:{include:{categories:true}}}}},take:100,orderBy:{handedAt:'desc'}});
  const categoryNames=[...new Set(history.flatMap(l=>l.copy.book.categories.map(c=>c.name)))];
  const excluded=[...new Set(history.map(l=>l.copy.bookId))];
  const books=await prisma.book.findMany({where:{archived:false,id:{notIn:excluded},...(categoryNames.length?{categories:{some:{name:{in:categoryNames}}}}:{})},include:publicBookInclude,take:6,orderBy:{createdAt:'desc'}});
  return {items:books.map(b=>({...serializeBook(b),reason:categoryNames.length?`Parce que vous avez emprunté en ${b.categories.filter(c=>categoryNames.includes(c.name)).map(c=>c.name).join(', ')}`:'À découvrir : sélection du catalogue récent'})),method:'CATEGORIES_FROM_LOAN_HISTORY'};
}
export async function proposeAcquisition(userId:string,input:{title:string;author:string;category:string;referenceUrl?:string;reason?:string}) {
  const student=await studentFor(userId);
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${student.id}::uuid FOR UPDATE`;
    const duplicate=await tx.acquisition.findFirst({where:{studentId:student.id,title:{equals:input.title,mode:'insensitive'},author:{equals:input.author,mode:'insensitive'},status:{not:'REFUSED'}}});
    if(duplicate) throw new HttpError(409,'DUPLICATE_ACQUISITION','Vous avez déjà proposé cet ouvrage.');
    const existing=await tx.book.findFirst({where:{archived:false,title:{equals:input.title,mode:'insensitive'}}});
    if(existing) throw new HttpError(409,'BOOK_EXISTS','Ce titre existe déjà dans le catalogue.');
    const item=await tx.acquisition.create({data:{studentId:student.id,...input}});
    const staff=await tx.user.findMany({where:{role:'LIBRARIAN',active:true},select:{id:true}});
    if(staff.length) await tx.notification.createMany({data:staff.map(s=>({userId:s.id,type:'ACQUISITION_SUBMITTED',content:`Nouvelle proposition : ${item.title}`,dedupeKey:`acquisition:${item.id}:${s.id}`}))});
    await tx.auditLog.create({data:{userId,action:'ACQUISITION_PROPOSED',entity:'Acquisition',entityId:item.id}});
    return item;
  });
}
