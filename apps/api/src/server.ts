import {createApp} from './app';
import {loadConfig} from './config';
const config=loadConfig();const app=await createApp(config);await app.listen({port:config.PORT,host:'0.0.0.0'});
console.log('Conta Fácil API en puerto '+config.PORT);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0)});
