import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ApiError } from "../api/errors";

function privateIpv4(value:string){
  const parts=value.split(".").map(Number);if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return true;
  const[a,b]=parts;
  return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===0)||(a===192&&b===168)||(a===198&&(b===18||b===19));
}

export function isPrivateAddress(value:string){
  const address=value.toLowerCase().replace(/^\[|\]$/g,"");
  if(address.startsWith("::ffff:"))return privateIpv4(address.slice(7));
  if(isIP(address)===4)return privateIpv4(address);
  if(isIP(address)===6)return address==="::"||address==="::1"||address.startsWith("fc")||address.startsWith("fd")||address.startsWith("fe8")||address.startsWith("fe9")||address.startsWith("fea")||address.startsWith("feb");
  return true;
}

export function normalizeSiteUrl(value:string){
  const candidate=/^https?:\/\//i.test(value.trim())?value.trim():`https://${value.trim()}`;
  let url:URL;try{url=new URL(candidate);}catch{throw new ApiError("Enter a valid website URL.",400,"VALIDATION_ERROR");}
  if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443")throw new ApiError("Website connections require a public HTTPS URL.",400,"VALIDATION_ERROR");
  url.hash="";url.search="";url.pathname=url.pathname.replace(/\/+$/,"");
  if(!url.hostname||url.hostname==="localhost"||url.hostname.endsWith(".local")||(isIP(url.hostname)!==0&&isPrivateAddress(url.hostname)))throw new ApiError("Private or local network addresses cannot be connected.",400,"VALIDATION_ERROR");
  return{siteUrl:url.toString().replace(/\/$/,""),canonicalDomain:url.hostname.toLowerCase().replace(/^www\./,"")};
}

export async function assertPublicSiteUrl(value:string){
  const normalized=normalizeSiteUrl(value),url=new URL(normalized.siteUrl);
  let addresses:{address:string}[];try{addresses=await lookup(url.hostname,{all:true,verbatim:true});}catch{throw new ApiError("The website hostname could not be resolved.",400,"WEBSITE_VERIFICATION_FAILED");}
  if(!addresses.length||addresses.some(item=>isPrivateAddress(item.address)))throw new ApiError("The website must resolve only to public internet addresses.",400,"WEBSITE_VERIFICATION_FAILED");
  return normalized;
}
