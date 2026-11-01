/* K-30: fuzz the CSV reader, the engine on accepted rows (every policy) and the JSON writer. */
/* Fuzz: CSV reader, JSON writer, engine. Run under ASan+UBSan. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "csv.h"
#include "engine.h"
#include "json.h"
static uint64_t st = 88172645463325252ull;
static uint64_t rnd(void){ st ^= st<<13; st ^= st>>7; st ^= st<<17; return st; }
static const char alpha[] = "0123456789,,,,\n\r-+. \"\\\t\0abcXYZ";
static const char *valid = "id,arrival,duration,cpu,mem,priority\n1,0,5,2,100,3\n2,1,4,1,50,9\n3,1,4,16,32768,0\n";
int main(int argc, char **argv){
  long N = argc>1 ? atol(argv[1]) : 100000; long i; long accepted=0, rejected=0, runs=0;
  char buf[2048];
  for(i=0;i<N;i++){
    size_t len; Job *jobs=NULL; int64_t n=0; CsvError e; int rc;
    int mode = rnd()%4;
    if(mode==0){ len = rnd()%600; for(size_t k=0;k<len;k++) buf[k]=(char)rnd(); }
    else if(mode==1){ len = rnd()%600; for(size_t k=0;k<len;k++) buf[k]=alpha[rnd()%(sizeof alpha)]; }
    else if(mode==2){ len=strlen(valid); memcpy(buf,valid,len); int m=1+rnd()%4; while(m--) buf[rnd()%len]=alpha[rnd()%(sizeof alpha)]; }
    else { /* header + random rows with large numbers and long lines */
      len = snprintf(buf,sizeof buf,"id,arrival,duration,cpu,mem,priority\n");
      int rows=rnd()%6; while(rows--){ int w; size_t room=sizeof buf-len; if(room<400)break;
        switch(rnd()%5){
          case 0: w=snprintf(buf+len,room,"%lld,%lld,%lld,%lld,%lld,%lld\n",(long long)(rnd()%3000000000ull)-5,(long long)(rnd()%2000000000ull),(long long)(rnd()%2000000),(long long)(rnd()%40),(long long)(rnd()%70000),(long long)(rnd()%12)); break;
          case 1: w=snprintf(buf+len,room,"%llu,0,1,1,1,0\n",(unsigned long long)rnd()); break;
          case 2: w=snprintf(buf+len,room,"99999999999999999999999,1,1,1,1,1\n"); break;
          case 3: { w=0; int L=240+rnd()%40; for(int k=0;k<L&&room-w>2;k++) buf[len+w++]='1'; buf[len+w++]='\n'; } break;
          default: w=snprintf(buf+len,room,"%d,%d,%d,%d,%d,%d\r\n",(int)(rnd()%50),(int)(rnd()%30),(int)(1+rnd()%9),(int)(1+rnd()%8),(int)(1+rnd()%900),(int)(rnd()%10)); }
        len+=w; }
    }
    rc = csv_read_jobs(buf,len,(int64_t)(rnd()%8),&jobs,&n,&e);
    if(rc!=APRM_OK){ rejected++; if(jobs!=NULL||n!=0){fprintf(stderr,"BAD: out/n set on failure\n");return 1;} if(strlen(e.message)>=sizeof e.message){return 1;} continue; }
    accepted++;
    /* run the engine on accepted jobs, every policy implemented */
    for(int pol=0; pol<6; pol++){
      SimConfig c; Sim *s=NULL; memset(&c,0,sizeof c);
      c.cpu_cap=16; c.mem_cap=32768; c.policy=(PolicyKind)pol; c.alpha_milli=rnd()%10001; c.reserve_threshold=rnd()%20; c.knapsack_eps_milli=100; c.max_jobs=1000;
      if(sim_create(&c,&s)!=APRM_OK) {fprintf(stderr,"create failed\n");return 1;}
      for(int64_t k=0;k<n;k++){ int r=sim_add_job(s,&jobs[k]); if(r!=APRM_OK && r!=APRM_CAPACITY_EXCEEDED && r!=APRM_DUPLICATE_ID && r!=APRM_ARRIVAL_IN_PAST){fprintf(stderr,"unexpected add rc %d\n",r);return 1;} }
      while(sim_step(s)==1){}
      JsonBuf j; json_init(&j);
      if(sim_state_json(s,&j)||sim_results_json(s,&j)||sim_metrics_json(s,&j)||sim_log_json(s,0,&j)){fprintf(stderr,"json fail\n");return 1;}
      json_free(&j); sim_destroy(s); runs++;
    }
    free(jobs);
  }
  /* JSON writer: random strings and call sequences */
  for(i=0;i<N;i++){
    JsonBuf j; char s[64]; json_init(&j);
    if(rnd()%4==0) json_set_limit(&j, 16+rnd()%200);
    int ops=rnd()%30;
    while(ops--){
      size_t L=rnd()%40; for(size_t k=0;k<L;k++) s[k]=(char)(rnd()%256); s[L]=0;
      switch(rnd()%12){
        case 0: json_obj_begin(&j);break; case 1: json_obj_end(&j);break; case 2: json_arr_begin(&j);break; case 3: json_arr_end(&j);break;
        case 4: json_key(&j,s);break; case 5: json_str(&j,s);break; case 6: json_i64(&j,(int64_t)rnd());break;
        case 7: json_milli(&j,(int64_t)rnd());break; case 8: json_bool(&j,(int)rnd()&1);break; case 9: json_null(&j);break;
        case 10: json_fixed9(&j,rnd(),(uint32_t)rnd());break; default: json_error(&j,-1,s,(rnd()&1)?s:NULL);
      }
    }
    if(json_status(&j)==0){ /* buffer must be NUL terminated and len consistent */ if(strlen(json_cstr(&j))!=json_len(&j)){ /* embedded NUL can't occur: escapes */ fprintf(stderr,"len mismatch\n"); return 1; } }
    json_free(&j);
  }
  printf("csv accepted=%ld rejected=%ld engine_runs=%ld json_cases=%ld OK\n",accepted,rejected,runs,N);
  return 0;
}
