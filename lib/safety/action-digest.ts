import {createHash} from "node:crypto";

type JsonPrimitive=string|number|boolean|null;
export type CanonicalValue=JsonPrimitive|CanonicalValue[]|{[key:string]:CanonicalValue};

function canonicalize(value:unknown):CanonicalValue{
  if(value===null||typeof value==="string"||typeof value==="boolean")return value;
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw new TypeError("Action payload numbers must be finite.");
    return Object.is(value,-0)?0:value;
  }
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.entries(value as Record<string,unknown>)
      .filter(([,item])=>item!==undefined)
      .sort(([left],[right])=>left.localeCompare(right))
      .map(([key,item])=>[key,canonicalize(item)]));
  }
  throw new TypeError("Action payloads may contain only JSON values.");
}

export function canonicalJson(value:unknown){return JSON.stringify(canonicalize(value));}
export function actionDigest(value:unknown){return createHash("sha256").update(canonicalJson(value)).digest("hex");}

