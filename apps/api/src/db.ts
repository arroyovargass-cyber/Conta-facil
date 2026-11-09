import pg from 'pg';
export type Claims={sub:string;aal:string;session_id:string;role?:string};
export async function scoped<T>(pool:pg.Pool,claims:Claims,run:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();try{await db.query('begin');await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({...claims,role:'authenticated'})]);const value=await run(db);await db.query('commit');return value}catch(e){await db.query('rollback');throw e}finally{db.release()}
}
export class HttpError extends Error{constructor(public statusCode:number,message:string){super(message)}}
export async function requirePermission(db:pg.PoolClient,tenant:string,permission:string,department:string|null=null){const r=await db.query('select private.has_access($1,$2,$3) allowed',[tenant,permission,department]);if(!r.rows[0]?.allowed)throw new HttpError(403,'No tienes permiso para realizar esta operación.')}
