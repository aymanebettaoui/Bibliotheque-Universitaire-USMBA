import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
const day=86_400_000;
const now=new Date();
const at=(days:number)=>new Date(now.getTime()+days*day);
if(process.env.NODE_ENV==='production' || process.env.DEMO_MODE!=='true')throw new Error('Le peuplement fictif est réservé à DEMO_MODE=true hors production.');
const onboardingData={id:'10000000-0000-4000-8000-000000000005',googleSub:'demo:onboarding',email:'inscription.demo@usmba.ac.ma',name:'Samir Exemple',role:'STUDENT' as const,student:{create:{id:'20000000-0000-4000-8000-000000000005',verified:false}}};
const ids={student:'10000000-0000-4000-8000-000000000001',student2:'10000000-0000-4000-8000-000000000002',librarian:'10000000-0000-4000-8000-000000000003',manager:'10000000-0000-4000-8000-000000000004'};
const books=[
 {title:'Clean Code',authors:['Robert C. Martin'],category:'Informatique',year:2008,publisher:'Prentice Hall',isbn:'9780132350884',price:280,color:'#234453',description:'Les principes et les bonnes pratiques pour écrire un code lisible, maintenable et rigoureusement testé.'},
 {title:'Introduction à l’algorithmique',authors:['Thomas H. Cormen','Charles E. Leiserson','Ronald L. Rivest','Clifford Stein'],category:'Informatique',year:2022,publisher:'Dunod',isbn:'9782100847137',price:450,color:'#9e5c43',description:'Une référence pour comprendre les structures de données, la complexité et les grands algorithmes.'},
 {title:'Intelligence artificielle : une approche moderne',authors:['Stuart Russell','Peter Norvig'],category:'Informatique',year:2021,publisher:'Pearson',isbn:'9782326001535',price:520,color:'#2b516b',description:'Agents intelligents, raisonnement, apprentissage automatique et représentation des connaissances.'},
 {title:'L’Étranger',authors:['Albert Camus'],category:'Littérature',year:1942,publisher:'Gallimard',isbn:'9782070360024',price:75,color:'#c5ad83',description:'Un roman majeur de la littérature française du XXe siècle, pour étudier l’absurde et la condition humaine.'},
 {title:'Le Petit Prince',authors:['Antoine de Saint-Exupéry'],category:'Littérature',year:1943,publisher:'Gallimard',isbn:'9782070612758',price:65,color:'#778c83',description:'Un conte poétique et philosophique sur l’amitié, la curiosité et le regard porté sur le monde.'},
 {title:'Bases de données',authors:['Georges Gardarin'],category:'Informatique',year:2003,publisher:'Eyrolles',isbn:'9782212112818',price:320,color:'#7d6861',description:'Le modèle relationnel, SQL, la conception des schémas et la gestion des transactions expliqués pas à pas.'},
 {title:'Analyse 1',authors:['Jean-Marie Monier'],category:'Mathématiques',year:2013,publisher:'Dunod',isbn:'9782100592105',price:190,color:'#687a89',description:'Cours, méthodes et exercices corrigés : suites, fonctions, limites, continuité et intégration.'},
 {title:'Physique tout-en-un',authors:['Marie-Noëlle Sanz','Bernard Salamito'],category:'Sciences',year:2021,publisher:'Dunod',isbn:'9782100824145',price:340,color:'#7d8657',description:'Les fondamentaux de mécanique, d’optique et de thermodynamique pour les premières années universitaires.'},
 {title:'Principes de l’économie',authors:['N. Gregory Mankiw'],category:'Économie',year:2020,publisher:'De Boeck',isbn:'9782807329843',price:280,color:'#b67f45',description:'Une introduction aux décisions économiques, aux marchés et aux grandes questions de macroéconomie.'},
 {title:'Histoire du Maroc',authors:['Daniel Rivet'],category:'Histoire',year:2012,publisher:'Fayard',isbn:'9782213638478',price:210,color:'#996a61',description:'Une traversée de l’histoire du Maroc et de ses transformations politiques, sociales et culturelles.'},
 {title:'Psychologie cognitive',authors:['Alain Lieury'],category:'Sciences humaines',year:2019,publisher:'Dunod',isbn:'9782100792437',price:150,color:'#7d7897',description:'Perception, attention, mémoire et apprentissage : les mécanismes fondamentaux de la cognition.'},
 {title:'Droit constitutionnel',authors:['Jean Gicquel','Jean-Éric Gicquel'],category:'Droit',year:2023,publisher:'LGDJ',isbn:'9782275116229',price:260,color:'#4f677a',description:'Les institutions, les régimes politiques, la séparation des pouvoirs et la protection des droits fondamentaux.'},
 {title:'La Boîte à merveilles',authors:['Ahmed Sefrioui'],category:'Littérature',year:1954,publisher:'Seuil',isbn:'9782020108710',price:60,color:'#aa7052',description:'Les souvenirs d’enfance d’un jeune garçon dans la médina de Fès, entre vie quotidienne et imaginaire.'},
 {title:'Réseaux informatiques',authors:['Andrew S. Tanenbaum','David J. Wetherall'],category:'Informatique',year:2022,publisher:'Pearson',isbn:'9782326003690',price:380,color:'#53817a',description:'Architecture réseau, protocoles Internet, communications sans fil et sécurité des échanges.'},
 {title:'Design Patterns',authors:['Erich Gamma','Richard Helm','Ralph Johnson','John Vlissides'],category:'Informatique',year:1994,publisher:'Addison-Wesley',isbn:'9780201633610',price:300,color:'#604c67',description:'Vingt-trois patrons de conception pour structurer les logiciels orientés objet et améliorer leur évolutivité.'},
 {title:'Algèbre linéaire',authors:['Joseph Grifone'],category:'Mathématiques',year:2015,publisher:'Cépaduès',isbn:'9782364931343',price:220,color:'#547578',description:'Espaces vectoriels, applications linéaires, matrices et réduction des endomorphismes avec exercices.'},
];
async function main(){
 const already=await prisma.book.count();
 if(already){await prisma.user.upsert({where:{googleSub:'demo:onboarding'},create:onboardingData,update:{}});console.info('La base contient déjà des ouvrages. Utilisez npm run db:reset pour réinitialiser la démonstration.');return;}
 await prisma.$transaction(async tx=>{
  const amina=await tx.user.create({data:{id:ids.student,googleSub:'demo:student',email:'amina.demo@usmba.ac.ma',name:'Amina El Idrissi',role:'STUDENT',student:{create:{id:'20000000-0000-4000-8000-000000000001',studentNumber:'R202400001',verified:true}}},include:{student:true}});
  const yassine=await tx.user.create({data:{id:ids.student2,googleSub:'demo:student2',email:'yassine.demo@usmba.ac.ma',name:'Yassine Bennani',role:'STUDENT',student:{create:{id:'20000000-0000-4000-8000-000000000002',studentNumber:'R202400002',verified:true,lateCycle:1}}},include:{student:true}});
  await tx.user.create({data:{id:ids.librarian,googleSub:'demo:librarian',email:'bibliothecaire.demo@usmba.ac.ma',name:'Salma Alaoui',role:'LIBRARIAN',canManageUsers:true,canManageSettings:true,canViewAudit:true,canRevokeSanctions:true}});
  await tx.user.create({data:{id:ids.manager,googleSub:'demo:manager',email:'responsable.demo@usmba.ac.ma',name:'Omar Fassi',role:'LIBRARIAN',canManageUsers:true,canManageSettings:true,canViewAudit:true,canRevokeSanctions:true}});
  await tx.user.upsert({where:{googleSub:'demo:onboarding'},create:onboardingData,update:{}});
  await tx.librarySettings.upsert({where:{id:'singleton'},create:{id:'singleton'},update:{}});
  await tx.identityVerification.createMany({data:[{userId:amina.id,studentNumber:'R202400001',provider:'DEMO',status:'VERIFIED',verifiedAt:at(-30)},{userId:yassine.id,studentNumber:'R202400002',provider:'DEMO',status:'VERIFIED',verifiedAt:at(-30)}]});
  const saved=[];
  for(let i=0;i<books.length;i++){
   const b=books[i];const id=`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
   const book=await tx.book.create({data:{id,title:b.title,isbn:b.isbn,publisher:b.publisher,year:b.year,priceDh:b.price,description:b.description,coverColor:b.color,createdAt:at(-30+i),authors:{connectOrCreate:b.authors.map(name=>({where:{name},create:{name}}))},categories:{connectOrCreate:[{where:{name:b.category},create:{name:b.category}}]},copies:{create:Array.from({length:i===2?2:3+i%2},(_,j)=>({barcode:`BU-${String(i+1).padStart(3,'0')}-${String(j+1).padStart(3,'0')}`}))}},include:{copies:true}});
   saved.push(book);
  }
  const loan=async(studentId:string,bookIndex:number,copyIndex:number,handed:number,due:number,returned?:number)=>{
   const copy=saved[bookIndex].copies[copyIndex];
   const item=await tx.loan.create({data:{studentId,copyId:copy.id,handedAt:at(handed),dueAt:at(due),status:returned!==undefined?'CLOSED':due<0?'OVERDUE':'ACTIVE',returnedAt:returned!==undefined?at(returned):null,handedById:ids.librarian,returnedById:returned!==undefined?ids.librarian:null}});
   if(returned===undefined)await tx.copy.update({where:{id:copy.id},data:{status:'LOANED'}});
   return item;
  };
  const reserve=async(studentId:string,bookIndex:number,copyIndex:number)=>{
   const request=await tx.borrowRequest.create({data:{studentId,bookId:saved[bookIndex].id,status:'ACCEPTED',createdAt:at(-.25)}});
   const copy=saved[bookIndex].copies[copyIndex];await tx.copy.update({where:{id:copy.id},data:{status:'RESERVED'}});
   return tx.reservation.create({data:{studentId,requestId:request.id,copyId:copy.id,expiresAt:at(1.75)}});
  };
  await loan(amina.student!.id,0,0,-8,6);
  await loan(amina.student!.id,8,0,-18,-4,-5);
  await reserve(amina.student!.id,5,0);
  const overdue=await loan(yassine.student!.id,2,0,-16,-2);
  await reserve(yassine.student!.id,2,1);
  const late=await tx.infraction.create({data:{studentId:yassine.student!.id,loanId:overdue.id,type:'LATE',createdAt:at(-2)}});
  await tx.sanction.create({data:{studentId:yassine.student!.id,infractionId:late.id,type:'WARNING',reason:'Premier retard du cycle — aucune suspension.',startsAt:at(-2),createdAt:at(-2)}});
  const damaged=await loan(yassine.student!.id,7,0,-25,-11,-12);
  await tx.copy.update({where:{id:saved[7].copies[0].id},data:{condition:'DAMAGED',status:'WITHDRAWN'}});
  const damage=await tx.infraction.create({data:{studentId:yassine.student!.id,loanId:damaged.id,type:'DAMAGE_MINOR',createdAt:at(-12)}});
  await tx.sanction.create({data:{studentId:yassine.student!.id,infractionId:damage.id,type:'SUSPENSION',reason:'Détérioration légère constatée au retour — règle de démonstration.',startsAt:at(-12),endsAt:at(3),createdAt:at(-12)}});
  const lost=await loan(yassine.student!.id,12,0,-30,-16,-18);
  await tx.copy.update({where:{id:saved[12].copies[0].id},data:{condition:'LOST',status:'WITHDRAWN'}});
  const loss=await tx.infraction.create({data:{studentId:yassine.student!.id,loanId:lost.id,type:'LOSS',createdAt:at(-18)}});
  await tx.sanction.create({data:{studentId:yassine.student!.id,infractionId:loss.id,type:'FINE',amountDh:60,reason:'Perte d’un ouvrage de 60 DH : indemnité de 100 %.',startsAt:at(-18),createdAt:at(-18)}});
  await tx.borrowRequest.create({data:{studentId:amina.student!.id,bookId:saved[11].id,status:'REFUSED',reason:'La limite d’emprunts était atteinte lors de cette demande.',createdAt:at(-10)}});
  await tx.acquisition.createMany({data:[{studentId:amina.student!.id,title:'The Pragmatic Programmer',author:'David Thomas, Andrew Hunt',category:'Informatique',reason:'Pour approfondir les bonnes pratiques de développement.',status:'SUBMITTED'},{studentId:yassine.student!.id,title:'Introduction à la sociologie',author:'Philippe Riutort',category:'Sciences humaines',reason:'Un support pour le cours de première année.',status:'ACCEPTED',comment:'Proposition retenue ; l’acquisition physique reste à effectuer.'}]});
  await tx.notification.createMany({data:[{userId:amina.id,type:'ACCOUNT_ACTIVATED',content:'Vérification simulée — environnement de démonstration. Votre espace étudiant fictif est prêt.'},{userId:amina.id,type:'REQUEST_ACCEPTED',content:'Bases de données vous attend au guichet. Présentez votre carte universitaire avant l’échéance.'},{userId:amina.id,type:'LOAN_CONFIRMED',content:'Votre emprunt de Clean Code est actif. Consultez la date de retour dans votre espace.'},{userId:ids.librarian,type:'ACQUISITION_SUBMITTED',content:'Une proposition d’acquisition de The Pragmatic Programmer est à étudier.'},{userId:yassine.id,type:'LOAN_OVERDUE',content:'Le retour de votre ouvrage Intelligence artificielle est en retard.'}]});
  await tx.auditLog.create({data:{userId:ids.manager,action:'DEMO_DATABASE_SEEDED',entity:'Library',entityId:'demo',details:{books:books.length,fictional:true}}});
 },{timeout:60000});
 console.info(`Démonstration créée : ${books.length} ouvrages, 5 comptes fictifs et circulation persistante.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
