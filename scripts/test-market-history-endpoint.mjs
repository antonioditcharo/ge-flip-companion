import dotenv from "dotenv";
dotenv.config({path:".env.local",quiet:true});
const url=process.argv.find(x=>x.startsWith("--url="))?.slice(6)??"http://localhost:3000/api/jobs/market-history";
const secret=process.env.MARKET_CRON_SECRET;
if(!secret)throw new Error("MARKET_CRON_SECRET is missing from .env.local");
const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${secret}`,Accept:"application/json"}});
const text=await response.text();console.log(response.status,text);if(!response.ok)process.exitCode=1;
