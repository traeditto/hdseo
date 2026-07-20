import http from "k6/http";
import {check} from "k6";

export const options={vus:25,duration:"5m",thresholds:{http_req_duration:["p(95)<1000"],http_req_failed:["rate<0.001"]}};
export default function webhookAcknowledgementLoad(){
  if(!__ENV.SIGNED_FIXTURE)throw new Error("SIGNED_FIXTURE is required.");
  const fixture=JSON.parse(__ENV.SIGNED_FIXTURE);
  const response=http.post(`${__ENV.BASE_URL}/api/github/webhook`,fixture.body,{headers:fixture.headers});
  check(response,{"webhook acknowledged":r=>r.status===200||r.status===202});
}
