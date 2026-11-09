let csrf='';
export function setCsrf(value:string){csrf=value}
export async function apiRequest<T=any>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch('/api'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.method&&options.method!=='GET'?{'X-CSRF-Token':csrf}:{}),...options.headers}});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.message??'No se pudo completar la operación.'),{status:response.status});return data}
export const post=(path:string,data:unknown,method='POST')=>apiRequest(path,{method,body:JSON.stringify(data)});
