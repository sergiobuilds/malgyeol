import {createCareApp} from '../../src/careApp.ts';
const app=createCareApp();
app.listen(0,'127.0.0.1',()=>{
  const address=app.address();
  if(address&&typeof address==='object') process.stdout.write(JSON.stringify({port:address.port})+'\n');
});
process.on('SIGTERM',()=>app.close(()=>process.exit(0)));
