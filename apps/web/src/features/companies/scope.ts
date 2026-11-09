export class CompanyScope{
 active:string|null=null;private version=0;
 select(id:string){this.active=id;this.version++}
 clear(){this.active=null;this.version++}
 async load<T>(run:()=>Promise<T>):Promise<T|undefined>{const version=this.version,value=await run();return version===this.version?value:undefined}
}
