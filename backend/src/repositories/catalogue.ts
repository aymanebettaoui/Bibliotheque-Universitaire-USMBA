import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
export const publicBookInclude = { authors:true, categories:true, copies:{select:{id:true,barcode:true,status:true,condition:true}} } satisfies Prisma.BookInclude;
export function serializeBook(book: any) {
  return { ...book, availableCount:book.copies.filter((c:any)=>c.status==='AVAILABLE' && c.condition==='GOOD').length, totalCount:book.copies.length, loanedCount:book.copies.filter((c:any)=>c.status==='LOANED').length };
}
export async function listBooks(input:{q?:string;category?:string;available?:boolean;sort:string;page:number;pageSize:number}) {
  const where:Prisma.BookWhereInput={archived:false};
  if(input.q) where.OR=[{title:{contains:input.q,mode:'insensitive'}},{description:{contains:input.q,mode:'insensitive'}},{isbn:{contains:input.q,mode:'insensitive'}},{authors:{some:{name:{contains:input.q,mode:'insensitive'}}}},{categories:{some:{name:{contains:input.q,mode:'insensitive'}}}}];
  if(input.category) where.categories={some:{OR:[{name:{equals:input.category,mode:'insensitive'}},...(/^[0-9a-f-]{36}$/i.test(input.category)?[{id:input.category}]:[])]}};
  if(input.available) where.copies={some:{status:'AVAILABLE',condition:'GOOD'}};
  const orderBy:Prisma.BookOrderByWithRelationInput = input.sort==='recent'?{createdAt:'desc'}:input.sort==='year'?{year:'desc'}:{title:'asc'};
  const [items,total,categories]=await prisma.$transaction([prisma.book.findMany({where,include:publicBookInclude,orderBy:[orderBy,{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),prisma.book.count({where}),prisma.category.findMany({orderBy:{name:'asc'}})]);
  return {items:items.map(serializeBook),total,page:input.page,pageSize:input.pageSize,categories};
}
export async function getBook(id:string) {
  const book=await prisma.book.findUnique({where:{id},include:publicBookInclude});
  if(!book || book.archived) throw new HttpError(404,'BOOK_NOT_FOUND','Cet ouvrage est introuvable.');
  return serializeBook(book);
}
