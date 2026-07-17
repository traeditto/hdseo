export function propertyMatchesDomain(property:string,domain:string){
  const normalizedDomain=domain.toLowerCase().replace(/^www\./,"").replace(/\.$/,"");
  if(property.startsWith("sc-domain:"))return property.slice(10).toLowerCase().replace(/^www\./,"")===normalizedDomain;
  try{return new URL(property).hostname.toLowerCase().replace(/^www\./,"")===normalizedDomain;}catch{return false;}
}
