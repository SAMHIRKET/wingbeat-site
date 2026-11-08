// Presentation canvases only. Drawing coordinates and card exports stay unchanged.
export const MAX_DECORATIVE_PIXELS=2_000_000;
export const MAX_DECORATIVE_EDGE=4096;
export const IDLE_AFTER_MS=15_000;
export function canvasBudget(w,h,dpr=1){
  const scale=Math.min(Math.max(1,dpr),2,Math.sqrt(MAX_DECORATIVE_PIXELS/(w*h)),MAX_DECORATIVE_EDGE/w,MAX_DECORATIVE_EDGE/h);
  return {scale,width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale))};
}
export function animationActive(now,lastInput,{hidden=false,focused=true,reduced=false}={}){
  return !hidden&&focused&&!reduced&&now-lastInput<IDLE_AFTER_MS;
}
