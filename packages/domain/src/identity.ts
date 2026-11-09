export function normalizeIdentification(input:{country:string;type:string;value:string}):string {
 const trimmed=input.value.trim();
 const value=input.country==='CR' && ['national','dimex'].includes(input.type)?trimmed.replace(/[-\s]/g,''):trimmed;
 if(!value || value.length>40 || /[\x00-\x1f]/.test(value)) throw new Error('Identificación inválida');
 return value;
}
