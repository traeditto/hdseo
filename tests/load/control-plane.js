import http from "k6/http";
import {check,sleep} from "k6";

export const options={
  scenarios:{
    sustained:{executor:"constant-arrival-rate",rate:Number(__ENV.RPS||250),timeUnit:"1s",duration:__ENV.DURATION||"30m",preAllocatedVUs:500,maxVUs:2000},
  },
  thresholds:{
    http_req_failed:["rate<0.001"],
    http_req_duration:["p(95)<500","p(99)<1500"],
  },
};

const base=__ENV.BASE_URL||"https://staging.hdseo.invalid";
const token=__ENV.TEST_SESSION_TOKEN;

export default function controlPlaneLoad(){
  if(!token)throw new Error("TEST_SESSION_TOKEN is required; never target production with this script.");
  const response=http.get(`${base}/api/system/readiness`,{headers:{Cookie:`${token}`},tags:{surface:"authenticated-read"}});
  check(response,{"response is not 5xx":r=>r.status<500});
  sleep(0.05);
}
