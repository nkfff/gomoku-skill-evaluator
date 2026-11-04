import test from "node:test";
import assert from "node:assert/strict";
import v2 from "../worker/index.js";
import v3 from "../worker/v3.js";

const env={
 FRONTEND_ORIGIN:"https://nkfff.github.io",
 APP_ORIGINS:"capacitor://localhost,https://localhost,gomoku://app"
};
const origins=["capacitor://localhost","https://localhost","gomoku://app"];

for(const [name,worker] of [["V2 account/review API",v2],["V3 PVP API",v3]]){
 test(name+" accepts only the configured native app origins",async()=>{
  for(const origin of origins){
   const preflight=await worker.fetch(new Request("https://worker.example/api/health",{
    method:"OPTIONS",
    headers:{
     Origin:origin,
     "Access-Control-Request-Method":"POST",
     "Access-Control-Request-Headers":"authorization,content-type"
    }
   }),env);
   assert.equal(preflight.status,204,origin);
   assert.equal(preflight.headers.get("Access-Control-Allow-Origin"),origin,origin);
   const health=await worker.fetch(new Request("https://worker.example/api/health",{
    headers:{Origin:origin}
   }),env);
   assert.equal(health.status,200,origin);
   assert.equal(health.headers.get("Access-Control-Allow-Origin"),origin,origin);
  }
  const denied=await worker.fetch(new Request("https://worker.example/api/health",{
   headers:{Origin:"https://malicious.example"}
  }),env);
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"),null);
 });
}
